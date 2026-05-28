// Native port of utils/xbogus.py::XBogus — W3.1.
// Byte-faithful to the vendor (MD5 over byte arrays + RC4 + a base64-ish
// recoding with a custom alphabet). Tracked in vendor-api/tally.json.
//
// The only non-determinism is `timer = int(time.time())`; build() takes an
// injectable `now` (epoch seconds) so golden vectors are reproducible. The
// default is the real wall clock, matching the Python.

import { createHash } from "node:crypto";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const CHARSET = "Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=";
const UA_KEY = [0x00, 0x01, 0x0c];
const CT = 536919696;

// Reproduces xbogus.py's 103-entry `_array`: hex-char code -> nibble value,
// '0'-'9' at 48-57, 'a'-'f' at 97-102, everything else null. Only ever indexed
// by lowercase-hex chars (md5 output), so the bounds match Python's.
const HEX_VALUE: (number | null)[] = (() => {
  const a = new Array<number | null>(103).fill(null);
  for (let i = 48; i <= 57; i++) a[i] = i - 48;
  for (let i = 97; i <= 102; i++) a[i] = i - 87;
  return a;
})();

// _md5_str_to_array: long strings -> char codes; hex strings -> packed nibbles.
function md5StrToArray(s: string): number[] {
  if (s.length > 32) {
    const out: number[] = [];
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }
  const arr: number[] = [];
  for (let i = 0; i < s.length; i += 2) {
    const hi = HEX_VALUE[s.charCodeAt(i)] ?? 0;
    const lo = HEX_VALUE[s.charCodeAt(i + 1)] ?? 0;
    arr.push((hi << 4) | lo);
  }
  return arr;
}

// _md5: hashes the byte array (a string is first packed via md5StrToArray).
function md5(input: string | number[]): string {
  const data = typeof input === "string" ? md5StrToArray(input) : input;
  return createHash("md5").update(Buffer.from(data)).digest("hex");
}

// _md5_encrypt
function md5Encrypt(urlPath: string): number[] {
  return md5StrToArray(md5(md5StrToArray(md5(urlPath))));
}

function rc4(key: ArrayLike<number>, data: ArrayLike<number>): number[] {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) % 256;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out: number[] = [];
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) % 256;
    j = (j + s[i]!) % 256;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out.push(data[n]! ^ s[(s[i]! + s[j]!) % 256]!);
  }
  return out;
}

// _calculation: pack 3 bytes, emit 4 chars from the custom alphabet.
function calculation(a1: number, a2: number, a3: number): string {
  const x3 = ((a1 & 255) << 16) | ((a2 & 255) << 8) | (a3 & 255);
  return (
    CHARSET[(x3 & 16515072) >> 18]! +
    CHARSET[(x3 & 258048) >> 12]! +
    CHARSET[(x3 & 4032) >> 6]! +
    CHARSET[x3 & 63]!
  );
}

export interface XBogusResult {
  signedUrl: string;
  xBogus: string;
  userAgent: string;
}

export function buildXBogus(
  url: string,
  opts: { userAgent?: string; now?: number } = {},
): XBogusResult {
  const userAgent = opts.userAgent && opts.userAgent.length > 0 ? opts.userAgent : DEFAULT_USER_AGENT;
  const timer = Math.floor(opts.now ?? Date.now() / 1000);

  const uaB64 = Buffer.from(rc4(UA_KEY, Buffer.from(userAgent, "latin1"))).toString("base64");
  const uaMd5 = md5StrToArray(md5(uaB64));
  const emptyMd5 = md5StrToArray(md5(md5StrToArray("d41d8cd98f00b204e9800998ecf8427e")));
  const urlMd5 = md5Encrypt(url);

  // newArray[1] is the float 0.00390625; it survives here and is truncated to 0
  // only where the payload reads int(i). Index order is load-bearing.
  const newArray: number[] = [
    64,
    0.00390625,
    1,
    12,
    urlMd5[14]!,
    urlMd5[15]!,
    emptyMd5[14]!,
    emptyMd5[15]!,
    uaMd5[14]!,
    uaMd5[15]!,
    (timer >>> 24) & 255,
    (timer >>> 16) & 255,
    (timer >>> 8) & 255,
    timer & 255,
    (CT >>> 24) & 255,
    (CT >>> 16) & 255,
    (CT >>> 8) & 255,
    CT & 255,
  ];
  let xor = newArray[0]!;
  for (let k = 1; k < newArray.length; k++) xor ^= Math.trunc(newArray[k]!);
  newArray.push(xor);

  // array3 = even indices, array4 = odd indices; merged = array3 ++ array4.
  const array3: number[] = [];
  const array4: number[] = [];
  for (let k = 0; k < newArray.length; k += 2) {
    array3.push(newArray[k]!);
    if (k + 1 < newArray.length) array4.push(newArray[k + 1]!);
  }
  const m = [...array3, ...array4]; // 19 values; m[10] is the 0.00390625 float

  // _encoding_conversion's exact payload order (a, int(i), b, _, c, x, ...).
  const payload = [
    m[0]!, Math.trunc(m[10]!), m[1]!, m[11]!, m[2]!, m[12]!, m[3]!, m[13]!, m[4]!,
    m[14]!, m[5]!, m[15]!, m[6]!, m[16]!, m[7]!, m[17]!, m[8]!, m[18]!, m[9]!,
  ];

  // _encoding_conversion(...).encode("ISO-8859-1") round-trips to `payload`.
  const garbled = [2, 255, ...rc4([255], payload)];

  let xb = "";
  for (let k = 0; k < garbled.length; k += 3) {
    xb += calculation(garbled[k]!, garbled[k + 1]!, garbled[k + 2]!);
  }

  return { signedUrl: `${url}&X-Bogus=${xb}`, xBogus: xb, userAgent };
}
