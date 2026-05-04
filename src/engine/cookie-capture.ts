// Direct read of Chrome's cookie SQLite + per-OS keystore decryption.
// Zero-touch: Chrome can stay running, no popup, no profile dance.
//
// macOS:   Keychain ("Chrome Safe Storage") → PBKDF2(SHA1, salt="saltysalt",
//          iter=1003, len=16) → AES-128-CBC, IV = 16 × 0x20.
// Windows: <UserData>/Local State → os_crypt.encrypted_key (base64) →
//          strip "DPAPI" prefix → DPAPI Unprotect → 32-byte AES key →
//          AES-256-GCM with 12-byte nonce + 16-byte tag.
//
// Both: encrypted_value starts with `v10`/`v11` prefix; strip before decrypt.
// Pre-v10 entries (rare today) are returned as-is.
//
// We copy the SQLite file to a temp path before opening so Chrome's running
// instance can keep its lock — SQLite's atomic commit semantics make any
// between-commit snapshot consistent.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";

const execFileAsync = promisify(execFile);

export interface CapturedCookies {
  jar: Record<string, string>;       // cookie name → value, full douyin jar
  count: number;
  hostsSeen: string[];               // distinct host_key values found
  profile: string;                   // resolved profile dir (the one we picked)
  scanned: ProfileSummary[];         // every profile we looked at
}

export interface ProfileSummary {
  name: string;                      // "Default", "Profile 1", …
  douyinCookies: number;             // count for *.douyin* hosts
}

export class CookieCaptureError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// Match cookies for any *.douyin* host (covers douyin.com, iesdouyin.com,
// douyincdn.com, etc.). Hosts are stored with leading dot for cross-subdomain.
const HOST_PATTERN = "%douyin%";

export async function captureChromeDouyinCookies(opts?: {
  profileName?: string;              // pin to a specific profile; otherwise auto
}): Promise<CapturedCookies> {
  const platform = process.platform;
  if (platform !== "darwin" && platform !== "win32") {
    throw new CookieCaptureError(
      "unsupported_os",
      `Auto-capture supports macOS and Windows; this is ${platform}.`,
    );
  }

  const userDataDir = resolveUserDataDir(platform);

  // 1. Discover profiles
  const profileNames = opts?.profileName
    ? [opts.profileName]
    : await listProfiles(userDataDir);

  // 2. Cheap count pass: how many douyin cookies in each profile?
  const summaries: ProfileSummary[] = [];
  for (const name of profileNames) {
    const profileDir = path.join(userDataDir, name);
    const cookiesFile = await tryFindCookiesFile(profileDir);
    if (!cookiesFile) {
      summaries.push({ name, douyinCookies: 0 });
      continue;
    }
    const tmp = await snapshotSqlite(cookiesFile);
    try {
      const n = countDouyinCookies(tmp);
      summaries.push({ name, douyinCookies: n });
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  // 3. Pick the richest profile
  const richest = summaries.reduce<ProfileSummary | null>(
    (best, p) => (best === null || p.douyinCookies > best.douyinCookies ? p : best),
    null,
  );

  if (!richest || richest.douyinCookies === 0) {
    throw new CookieCaptureError(
      "no_cookies_anywhere",
      `No douyin cookies found in any Chrome profile. ` +
      `Scanned: ${summaries.map((s) => `${s.name}(${s.douyinCookies})`).join(", ") || "(none)"}.\n` +
      `Sign in to douyin.com in any Chrome profile, then re-run.`,
    );
  }

  // 4. Read + decrypt the chosen profile
  const profileDir = path.join(userDataDir, richest.name);
  const cookiesPath = (await tryFindCookiesFile(profileDir))!;
  const tmpPath = await snapshotSqlite(cookiesPath);

  try {
    const rawRows = readCookieRows(tmpPath);
    const key = platform === "darwin" ? await macKey() : await windowsKey(userDataDir);

    const jar: Record<string, string> = {};
    const hosts = new Set<string>();
    let decryptOk = 0;
    for (const row of rawRows) {
      hosts.add(row.host_key);
      let value: string | null = null;
      if (row.encrypted_value && row.encrypted_value.length > 0) {
        value = platform === "darwin"
          ? decryptMac(row.encrypted_value, key)
          : decryptWindows(row.encrypted_value, key);
        if (value !== null) decryptOk++;
      }
      if ((value === null || value === "") && typeof row.value === "string" && row.value) {
        value = row.value;
      }
      // Skip cookies with empty names (rare malformed Set-Cookie entries).
      if (value !== null && row.name) jar[row.name] = value;
    }

    if (decryptOk === 0 && rawRows.length > 0) {
      throw new CookieCaptureError(
        "decrypt_all_failed",
        `Found ${rawRows.length} encrypted cookies in ${richest.name} but none decrypted. ` +
        `Chrome's keystore key may have rotated; re-running often fixes it.`,
      );
    }

    return {
      jar,
      count: Object.keys(jar).length,
      hostsSeen: [...hosts].sort(),
      profile: profileDir,
      scanned: summaries.sort((a, b) => b.douyinCookies - a.douyinCookies),
    };
  } finally {
    await fs.rm(tmpPath, { force: true });
  }
}

async function listProfiles(userDataDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(userDataDir);
  } catch {
    return [];
  }
  return entries.filter((e) => e === "Default" || /^Profile \d+$/.test(e));
}

async function tryFindCookiesFile(profileDir: string): Promise<string | null> {
  const candidates = [
    path.join(profileDir, "Network", "Cookies"),
    path.join(profileDir, "Cookies"),
  ];
  for (const c of candidates) {
    try { await fs.access(c); return c; } catch { /* try next */ }
  }
  return null;
}

function countDouyinCookies(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare(
      "SELECT COUNT(*) as n FROM cookies WHERE host_key LIKE ?",
    ).get(HOST_PATTERN) as { n: number };
    return row?.n ?? 0;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function resolveUserDataDir(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");
  }
  if (platform === "win32") {
    const localApp = process.env["LOCALAPPDATA"];
    if (!localApp) {
      throw new CookieCaptureError("no_localappdata", "LOCALAPPDATA env var is not set.");
    }
    return path.join(localApp, "Google", "Chrome", "User Data");
  }
  throw new CookieCaptureError("unsupported_os", platform);
}

async function snapshotSqlite(srcPath: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hozon-cookies-"));
  const dest = path.join(tmpDir, "Cookies.sqlite");
  await fs.copyFile(srcPath, dest);
  return dest;
}

// ---------------------------------------------------------------------------
// SQLite read
// ---------------------------------------------------------------------------

interface CookieRow {
  host_key: string;
  name: string;
  value: string | null;
  encrypted_value: Buffer | null;
}

function readCookieRows(dbPath: string): CookieRow[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const stmt = db.prepare(`
      SELECT host_key, name, value, encrypted_value
      FROM cookies
      WHERE host_key LIKE ?
    `);
    return stmt.all(HOST_PATTERN) as CookieRow[];
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// macOS key + decrypt
// ---------------------------------------------------------------------------

async function macKey(): Promise<Buffer> {
  let password: string;
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-w", "-s", "Chrome Safe Storage"],
      { timeout: 10_000 },
    );
    password = stdout.trim();
  } catch (err) {
    throw new CookieCaptureError(
      "keychain_denied",
      `Could not read Chrome Safe Storage from Keychain: ${
        err instanceof Error ? err.message : String(err)
      }. The OS may have prompted you to allow access; allow it and retry.`,
    );
  }
  if (!password) {
    throw new CookieCaptureError("keychain_empty", "Keychain returned empty Chrome key.");
  }
  return crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}

function decryptMac(buf: Buffer, key: Buffer): string | null {
  if (buf.length < 3) return null;
  const prefix = buf.subarray(0, 3).toString("ascii");
  if (prefix !== "v10" && prefix !== "v11") {
    return safeUtf8(buf);
  }
  const ciphertext = buf.subarray(3);
  const iv = Buffer.alloc(16, 0x20);
  let plain: Buffer;
  try {
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
  return stripChromeShaPrefix(plain);
}

// ---------------------------------------------------------------------------
// Windows key + decrypt
// ---------------------------------------------------------------------------

async function windowsKey(userDataDir: string): Promise<Buffer> {
  const localStatePath = path.join(userDataDir, "Local State");
  const raw = await fs.readFile(localStatePath, "utf8");
  let encryptedKeyB64: string | undefined;
  try {
    encryptedKeyB64 = JSON.parse(raw)?.os_crypt?.encrypted_key;
  } catch (err) {
    throw new CookieCaptureError("local_state_parse", `Could not parse ${localStatePath}`);
  }
  if (!encryptedKeyB64) {
    throw new CookieCaptureError(
      "no_encrypted_key",
      `Local State has no os_crypt.encrypted_key (Chrome may have moved to App-Bound Encryption — needs Chrome elevation).`,
    );
  }
  const encryptedKey = Buffer.from(encryptedKeyB64, "base64");
  // Strip the 5-byte "DPAPI" prefix.
  const blob = encryptedKey.subarray(5);
  return await dpapiUnprotect(blob);
}

async function dpapiUnprotect(blob: Buffer): Promise<Buffer> {
  const b64 = blob.toString("base64");
  // Defense-in-depth: base64 alphabet is `[A-Za-z0-9+/=]` only. Reject
  // anything else before splicing into a PowerShell single-quoted string,
  // so a hypothetical compromised Local State can't inject single quotes.
  if (!/^[A-Za-z0-9+/=]*$/.test(b64)) {
    throw new CookieCaptureError(
      "encrypted_key_corrupt",
      "Local State's os_crypt.encrypted_key contains non-base64 characters.",
    );
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$bytes = [Convert]::FromBase64String('${b64}')`,
    "Add-Type -AssemblyName System.Security",
    "$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Convert]::ToBase64String($plain) | Write-Output",
  ].join("; ");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 15_000 },
    );
    return Buffer.from(stdout.trim(), "base64");
  } catch (err) {
    throw new CookieCaptureError(
      "dpapi_failed",
      `DPAPI unprotect failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function decryptWindows(buf: Buffer, key: Buffer): string | null {
  if (buf.length < 3) return null;
  const prefix = buf.subarray(0, 3).toString("ascii");
  if (prefix !== "v10" && prefix !== "v11") {
    return safeUtf8(buf);
  }
  if (buf.length < 3 + 12 + 16) return null;
  const nonce = buf.subarray(3, 15);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(15, buf.length - 16);
  let plain: Buffer;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
  return stripChromeShaPrefix(plain);
}

// Chrome 130+ prepends a 32-byte SHA-256(host || name || value || origin) hash
// to the plaintext as anti-tamper. Older entries don't have it.
//
// Heuristic: SHA-256 hashes are uniformly distributed bytes — almost always
// contain at least one byte ≥ 0x80, and almost never start with printable
// ASCII. If the first 32 bytes look like a hash AND the remainder is a
// reasonable cookie value (printable, non-empty), strip. Otherwise, treat
// the whole buffer as plaintext. This avoids the false positive where a
// short legitimately-printable value gets truncated to its tail.
function stripChromeShaPrefix(plain: Buffer): string | null {
  if (plain.length >= 32 && looksLikeShaPrefix(plain)) {
    const stripped = safeUtf8(plain.subarray(32));
    if (stripped !== null && stripped.length > 0) return stripped;
  }
  return safeUtf8(plain);
}

function looksLikeShaPrefix(buf: Buffer): boolean {
  // Real cookie text is ASCII-printable (cookie values can't contain control
  // bytes). A SHA-256 prefix has ~12 of 32 bytes < 0x20 or ≥ 0x7f on
  // average. If at least 4 of the first 32 bytes are non-printable, treat
  // them as a hash prefix.
  let nonPrintable = 0;
  for (let i = 0; i < 32; i++) {
    const b = buf[i]!;
    if (b < 0x20 || b >= 0x7f) nonPrintable++;
    if (nonPrintable >= 4) return true;
  }
  return false;
}

// Reject buffers whose UTF-8 decoding looks like noise. We allow:
//   - empty string
//   - strings without any U+FFFD (replacement char from invalid UTF-8)
//   - strings where ≥95% of characters are printable (covers ASCII +
//     percent-escaped + CJK that valid Chrome cookies can contain)
function safeUtf8(buf: Buffer): string | null {
  if (buf.length === 0) return "";
  const s = buf.toString("utf8");
  if (s.includes("�")) return null;
  let printable = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0) return null;                          // NUL → garbage
    if (code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) printable++;
  }
  return printable / s.length >= 0.95 ? s : null;
}
