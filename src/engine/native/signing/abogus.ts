// Native port of utils/abogus.py — W3.3. The synthesis's "single most fragile
// artifact": SM3 + dual custom base64 + RC4 + a stateful array shuffle + a
// browser-fingerprint, reverse-engineered from douyin's obfuscated VM.
// Tracked in vendor-api/tally.json (ABogus.__init__, generate_abogus,
// BrowserFingerprintGenerator.generate_fingerprint).
//
// Three non-determinism sources are injectable so golden vectors reproduce:
//   - time.time()  -> `now` (ms); the Python reads it twice (start/end), frozen
//   - generate_random_bytes() -> `randomBytes` (char-code prefix)
//   - the browser fingerprint -> `fp`
//
// CRITICAL trap: start/end are ~1.7e12-ms timestamps. JS >> / >>> coerce to
// (u)int32 first, corrupting the high bits, so every timestamp byte uses
// float division (exact below 2^53), NOT bit shifts.

import { createHash } from "node:crypto";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

// (n >> shift) & 255 for big n, via float division (no int32 coercion).
const tsByte = (n: number, shift: number): number => Math.floor(n / 2 ** shift) % 256;

// ---- StringProcessor ----
function jsShiftRight(val: number, n: number): number {
  return Math.floor((val % 0x100000000) / 2 ** n);
}

function generateByteSequence(rng: () => number): number[] {
  const rd = Math.floor(rng() * 10000);
  return [
    ((rd & 255) & 170) | 1,
    ((rd & 255) & 85) | 2,
    (jsShiftRight(rd, 8) & 170) | 5,
    (jsShiftRight(rd, 8) & 85) | 40,
  ];
}

// generate_random_bytes: `length` 4-byte sequences. Returns char codes.
export function generateRandomBytes(length = 3, rng: () => number = Math.random): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i++) out.push(...generateByteSequence(rng));
  return out;
}

const BIG_ARRAY: readonly number[] = [
  121, 243, 55, 234, 103, 36, 47, 228, 30, 231, 106, 6, 115, 95, 78, 101, 250, 207, 198, 50,
  139, 227, 220, 105, 97, 143, 34, 28, 194, 215, 18, 100, 159, 160, 43, 8, 169, 217, 180, 120,
  247, 45, 90, 11, 27, 197, 46, 3, 84, 72, 5, 68, 62, 56, 221, 75, 144, 79, 73, 161,
  178, 81, 64, 187, 134, 117, 186, 118, 16, 241, 130, 71, 89, 147, 122, 129, 65, 40, 88, 150,
  110, 219, 199, 255, 181, 254, 48, 4, 195, 248, 208, 32, 116, 167, 69, 201, 17, 124, 125, 104,
  96, 83, 80, 127, 236, 108, 154, 126, 204, 15, 20, 135, 112, 158, 13, 1, 188, 164, 210, 237,
  222, 98, 212, 77, 253, 42, 170, 202, 26, 22, 29, 182, 251, 10, 173, 152, 58, 138, 54, 141,
  185, 33, 157, 31, 252, 132, 233, 235, 102, 196, 191, 223, 240, 148, 39, 123, 92, 82, 128, 109,
  57, 24, 38, 113, 209, 245, 2, 119, 153, 229, 189, 214, 230, 174, 232, 63, 52, 205, 86, 140,
  66, 175, 111, 171, 246, 133, 238, 193, 99, 60, 74, 91, 225, 51, 76, 37, 145, 211, 166, 151,
  213, 206, 0, 200, 244, 176, 218, 44, 184, 172, 49, 216, 93, 168, 53, 21, 183, 41, 67, 85,
  224, 155, 226, 242, 87, 177, 146, 70, 190, 12, 162, 19, 137, 114, 25, 165, 163, 192, 23, 59,
  9, 94, 179, 107, 35, 7, 142, 131, 239, 203, 149, 136, 61, 249, 14, 156,
];

// ---- CryptoUtility ----
class CryptoUtility {
  private bigArray: number[];

  constructor(private readonly salt: string, private readonly alphabets: string[]) {
    this.bigArray = [...BIG_ARRAY]; // fresh per instance (transform_bytes mutates it)
  }

  static sm3ToArray(input: string | number[]): number[] {
    const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
    const hex = createHash("sm3").update(buf).digest("hex");
    const out: number[] = [];
    for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
    return out;
  }

  private addSalt(param: string): string {
    return param + this.salt;
  }

  private paramsToArray(param: string | number[], addSalt = true): number[] {
    const processed = typeof param === "string" && addSalt ? this.addSalt(param) : param;
    return CryptoUtility.sm3ToArray(processed);
  }

  // params_to_array(params_to_array(x)) — outer arg is a number[] so no salt.
  paramsToArrayDouble(param: string): number[] {
    return this.paramsToArray(this.paramsToArray(param));
  }

  uaArray(uaRc4: number[]): number[] {
    return this.paramsToArray(this.base64Encode(toCharStr(uaRc4), 1), false);
  }

  transformBytes(bytesList: number[]): string {
    const bytesStr = toCharStr(bytesList);
    const result: string[] = [];
    const arr = this.bigArray;
    const len = arr.length;
    let indexB = arr[1]!;
    let initialValue = 0;
    let valueE = 0;
    for (let index = 0; index < bytesStr.length; index++) {
      let sumInitial: number;
      if (index === 0) {
        initialValue = arr[indexB]!;
        sumInitial = indexB + initialValue;
        arr[1] = initialValue;
        arr[indexB] = indexB;
      } else {
        sumInitial = initialValue + valueE;
      }
      const charValue = bytesStr.charCodeAt(index);
      sumInitial %= len;
      const valueF = arr[sumInitial]!;
      result.push(String.fromCharCode(charValue ^ valueF));

      valueE = arr[(index + 2) % len]!;
      sumInitial = (indexB + valueE) % len;
      initialValue = arr[sumInitial]!;
      arr[sumInitial] = arr[(index + 2) % len]!;
      arr[(index + 2) % len] = initialValue;
      indexB = sumInitial;
    }
    return result.join("");
  }

  base64Encode(input: string, selectedAlphabet = 0): string {
    let bin = "";
    for (let i = 0; i < input.length; i++) bin += input.charCodeAt(i).toString(2).padStart(8, "0");
    const pad = (6 - (bin.length % 6)) % 6;
    bin += "0".repeat(pad);
    const alphabet = this.alphabets[selectedAlphabet]!;
    let out = "";
    for (let i = 0; i < bin.length; i += 6) out += alphabet[parseInt(bin.slice(i, i + 6), 2)];
    return out + "=".repeat(Math.floor(pad / 2));
  }

  abogusEncode(bytesStr: string, selectedAlphabet: number): string {
    const alphabet = this.alphabets[selectedAlphabet]!;
    const len = bytesStr.length;
    const out: string[] = [];
    for (let i = 0; i < len; i += 3) {
      let n: number;
      if (i + 2 < len) {
        n = (bytesStr.charCodeAt(i) << 16) | (bytesStr.charCodeAt(i + 1) << 8) | bytesStr.charCodeAt(i + 2);
      } else if (i + 1 < len) {
        n = (bytesStr.charCodeAt(i) << 16) | (bytesStr.charCodeAt(i + 1) << 8);
      } else {
        n = bytesStr.charCodeAt(i) << 16;
      }
      const shifts = [18, 12, 6, 0];
      const masks = [0xfc0000, 0x03f000, 0x0fc0, 0x3f];
      for (let s = 0; s < 4; s++) {
        const j = shifts[s]!;
        if (j === 6 && i + 1 >= len) break;
        if (j === 0 && i + 2 >= len) break;
        out.push(alphabet[(n & masks[s]!) >> j]!);
      }
    }
    out.push("=".repeat((4 - (out.length % 4)) % 4));
    return out.join("");
  }

  static rc4Encrypt(key: number[], plaintext: string): number[] {
    const s = Array.from({ length: 256 }, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + s[i]! + key[i % key.length]!) % 256;
      [s[i], s[j]] = [s[j]!, s[i]!];
    }
    let i = 0;
    j = 0;
    const out: number[] = [];
    for (let n = 0; n < plaintext.length; n++) {
      i = (i + 1) % 256;
      j = (j + s[i]!) % 256;
      [s[i], s[j]] = [s[j]!, s[i]!];
      out.push(plaintext.charCodeAt(n) ^ s[(s[i]! + s[j]!) % 256]!);
    }
    return out;
  }
}

function toCharStr(list: number[]): string {
  let s = "";
  for (const n of list) s += String.fromCharCode(n);
  return s;
}

// ---- BrowserFingerprintGenerator ----
export function generateFingerprint(platform = "Win32", rng: () => number = Math.random): string {
  const randint = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const innerWidth = randint(1024, 1920);
  const innerHeight = randint(768, 1080);
  const outerWidth = innerWidth + randint(24, 32);
  const outerHeight = innerHeight + randint(75, 90);
  const screenY = [0, 30][Math.floor(rng() * 2)]!;
  const sizeWidth = randint(1024, 1920);
  const sizeHeight = randint(768, 1080);
  const availWidth = randint(1280, 1920);
  const availHeight = randint(800, 1080);
  return (
    `${innerWidth}|${innerHeight}|${outerWidth}|${outerHeight}|0|${screenY}|0|0|` +
    `${sizeWidth}|${sizeHeight}|${availWidth}|${availHeight}|${innerWidth}|${innerHeight}|24|24|${platform}`
  );
}

// ---- ABogus ----
const CHARACTER = "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe";
const CHARACTER2 = "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe";
const UA_KEY = [0x00, 0x01, 0x0e];
const SORT_INDEX = [
  18, 20, 52, 26, 30, 34, 58, 38, 40, 53, 42, 21, 27, 54, 55, 31, 35, 57, 39, 41, 43, 22, 28,
  32, 60, 36, 23, 29, 33, 37, 44, 45, 59, 46, 47, 48, 49, 50, 24, 25, 65, 66, 70, 71,
];
const SORT_INDEX_2 = [
  18, 20, 26, 30, 34, 38, 40, 42, 21, 27, 31, 35, 39, 41, 43, 22, 28, 32, 36, 23, 29, 33, 37,
  44, 45, 46, 47, 48, 49, 50, 24, 25, 52, 53, 54, 55, 57, 58, 59, 60, 65, 66, 70, 71,
];

export interface ABogusResult {
  signedParams: string;
  aBogus: string;
  userAgent: string;
  body: string;
}

export interface ABogusOptions {
  userAgent?: string;
  fp?: string;
  options?: number[];
  now?: number; // ms; the Python reads time.time twice (start==end when frozen)
  randomBytes?: number[]; // generate_random_bytes() prefix (char codes)
  rng?: () => number; // used only when fp / randomBytes are not injected
}

// Fresh state per call (transform_bytes mutates big_array; the vendor reuses
// the instance, but a fresh one per signature is the clean, reproducible API).
export function buildABogus(params: string, body = "", opts: ABogusOptions = {}): ABogusResult {
  const rng = opts.rng ?? Math.random;
  const aid = 6383;
  const pageId = 0;
  const options = opts.options ?? [0, 1, 14];
  const userAgent = opts.userAgent && opts.userAgent.length > 0 ? opts.userAgent : DEFAULT_USER_AGENT;
  const fp = opts.fp && opts.fp.length > 0 ? opts.fp : generateFingerprint("Win32", rng);
  const now = opts.now ?? Date.now();
  const randomBytes = opts.randomBytes ?? generateRandomBytes(3, rng);

  const crypto = new CryptoUtility("cus", [CHARACTER, CHARACTER2]);

  const array1 = crypto.paramsToArrayDouble(params);
  const array2 = crypto.paramsToArrayDouble(body);
  const array3 = crypto.uaArray(CryptoUtility.rc4Encrypt(UA_KEY, userAgent));

  const start = now;
  const end = now;

  const d: Record<number, number> = {};
  d[8] = 3;
  d[18] = 44;
  d[20] = tsByte(start, 24);
  d[21] = tsByte(start, 16);
  d[22] = tsByte(start, 8);
  d[23] = start % 256;
  d[24] = Math.trunc(start / 2 ** 32);
  d[25] = Math.trunc(start / 2 ** 40);
  d[26] = (options[0]! >> 24) & 255;
  d[27] = (options[0]! >> 16) & 255;
  d[28] = (options[0]! >> 8) & 255;
  d[29] = options[0]! & 255;
  d[30] = Math.trunc(options[1]! / 256) & 255;
  d[31] = options[1]! % 256 & 255;
  d[32] = (options[1]! >> 24) & 255;
  d[33] = (options[1]! >> 16) & 255;
  d[34] = (options[2]! >> 24) & 255;
  d[35] = (options[2]! >> 16) & 255;
  d[36] = (options[2]! >> 8) & 255;
  d[37] = options[2]! & 255;
  d[38] = array1[21]!;
  d[39] = array1[22]!;
  d[40] = array2[21]!;
  d[41] = array2[22]!;
  d[42] = array3[23]!;
  d[43] = array3[24]!;
  d[44] = tsByte(end, 24);
  d[45] = tsByte(end, 16);
  d[46] = tsByte(end, 8);
  d[47] = end % 256;
  d[48] = d[8]!;
  d[49] = Math.trunc(end / 2 ** 32);
  d[50] = Math.trunc(end / 2 ** 40);
  d[51] = (pageId >> 24) & 255;
  d[52] = (pageId >> 16) & 255;
  d[53] = (pageId >> 8) & 255;
  d[54] = pageId & 255;
  d[55] = pageId;
  d[56] = aid;
  d[57] = aid & 255;
  d[58] = (aid >> 8) & 255;
  d[59] = (aid >> 16) & 255;
  d[60] = (aid >> 24) & 255;
  d[64] = fp.length;
  d[65] = fp.length;

  const sortedValues = SORT_INDEX.map((i) => d[i] ?? 0);
  const edgeFpArray: number[] = [];
  for (let i = 0; i < fp.length; i++) edgeFpArray.push(fp.charCodeAt(i));

  let abXor = 0;
  for (let index = 0; index < SORT_INDEX_2.length - 1; index++) {
    if (index === 0) abXor = d[SORT_INDEX_2[index]!] ?? 0;
    abXor ^= d[SORT_INDEX_2[index + 1]!] ?? 0;
  }

  sortedValues.push(...edgeFpArray, abXor);

  const abogusBytesStr = toCharStr(randomBytes) + crypto.transformBytes(sortedValues);
  const aBogus = crypto.abogusEncode(abogusBytesStr, 0);
  return { signedParams: `${params}&a_bogus=${aBogus}`, aBogus, userAgent, body };
}
