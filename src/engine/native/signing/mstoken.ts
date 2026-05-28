// Native port of auth/ms_token_manager.py::MsTokenManager — W3.2.
// Tracked in vendor-api/tally.json (MsTokenManager.__init__, ensure_ms_token).
//
// Strategy mirrors the vendor: prefer a real msToken from the F2 mssdk
// endpoint, fall back to a random one so the request params stay complete.
// The deterministic surfaces (validity, fallback shape, Set-Cookie parse) are
// pure; the real-token path is network and is exercised by the HTTP layer.

import { parse as parseYaml } from "yaml";

const F2_CONF_URL = "https://raw.githubusercontent.com/Johnserf-Seed/f2/main/f2/conf/conf.yaml";
// string.ascii_letters + string.digits (order is irrelevant — random.choice).
const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// _is_valid_ms_token: F2 tokens are 164 or 184 chars after strip.
export function isValidMsToken(token: string | null | undefined): boolean {
  if (!token || typeof token !== "string") return false;
  const len = token.trim().length;
  return len === 164 || len === 184;
}

// gen_false_ms_token: 182 alphanumerics + "==" (184 total).
export function genFalseMsToken(rng: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 182; i++) s += ALNUM[Math.floor(rng() * ALNUM.length)];
  return `${s}==`;
}

// _extract_ms_token_from_headers: first msToken value across Set-Cookie lines.
export function extractMsTokenFromSetCookie(setCookies: string[]): string | null {
  for (const header of setCookies ?? []) {
    const m = /(?:^|;\s*)msToken=([^;]*)/.exec(header);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return null;
}

interface MsTokenConf {
  url: string;
  magic: string;
  version: string;
  dataType: string;
  ulr: string;
  strData: string;
}
const REQUIRED_CONF_KEYS: (keyof MsTokenConf)[] = ["url", "magic", "version", "dataType", "ulr", "strData"];

export class MsTokenManager {
  private static cachedConf: MsTokenConf | null = null;
  private static cachedAt = 0;
  private static readonly cacheTtlMs = 3600 * 1000;

  constructor(
    private readonly userAgent: string,
    private readonly confUrl: string = F2_CONF_URL,
    private readonly timeoutSeconds: number = 15,
  ) {}

  // ensure_ms_token: existing cookie wins; else real; else random fallback.
  // `genReal` is injectable so tests need no network.
  async ensureMsToken(
    cookies: Record<string, string>,
    genReal: () => Promise<string | null> = () => this.genRealMsToken(),
  ): Promise<string> {
    const current = (cookies?.["msToken"] ?? "").trim();
    if (current) return current;
    const real = await genReal();
    if (real) return real;
    return genFalseMsToken();
  }

  async genRealMsToken(): Promise<string | null> {
    const conf = await this.loadF2MsTokenConf();
    if (!conf) return null;
    const payload = {
      magic: conf.magic,
      version: conf.version,
      dataType: conf.dataType,
      strData: conf.strData,
      ulr: conf.ulr,
      tspFromClient: Date.now(),
    };
    try {
      const resp = await this.fetchWithTimeout(conf.url, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": this.userAgent },
        body: JSON.stringify(payload),
      });
      const setCookies = resp.headers.getSetCookie?.() ?? [];
      const token = extractMsTokenFromSetCookie(setCookies);
      return isValidMsToken(token) ? token!.trim() : null;
    } catch {
      return null;
    }
  }

  private async loadF2MsTokenConf(): Promise<MsTokenConf | null> {
    const now = Date.now();
    if (MsTokenManager.cachedConf && now - MsTokenManager.cachedAt < MsTokenManager.cacheTtlMs) {
      return MsTokenManager.cachedConf;
    }
    try {
      const resp = await this.fetchWithTimeout(this.confUrl, { method: "GET" });
      const raw = await resp.text();
      const data = (parseYaml(raw) ?? {}) as Record<string, any>;
      const msConf = data?.["f2"]?.["douyin"]?.["msToken"] as Partial<MsTokenConf> | undefined;
      if (!msConf || !REQUIRED_CONF_KEYS.every((k) => k in msConf)) return null;
      MsTokenManager.cachedConf = msConf as MsTokenConf;
      MsTokenManager.cachedAt = now;
      return MsTokenManager.cachedConf;
    } catch {
      return null;
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutSeconds * 1000);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
