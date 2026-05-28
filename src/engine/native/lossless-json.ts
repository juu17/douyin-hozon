// Lossless JSON parse for douyin's 19-digit ids — retro-audit F1/F4 fix.
//
// JS `JSON.parse` represents every number as a float64, so any integer
// > Number.MAX_SAFE_INTEGER (2^53-1) is silently truncated. douyin emits
// aweme_id / music id / sec_uid / mix_id as up-to-19-digit integers; if any
// arrives as a *bare JSON number* it is corrupted before any code sees it,
// poisoning the (UNIQUE) dedup key and the on-disk filename. Python's json
// keeps arbitrary-precision ints, so the sidecar never had this — it's a
// porting regression.
//
// A reviver can't fix it (the value is already truncated by the time the
// reviver runs). So we pre-quote any integer literal that would lose precision
// at the TEXT level, then JSON.parse — turning oversized ids into exact
// strings. Only pure integers exceeding MAX_SAFE_INTEGER are touched; floats,
// exponents, small ints, and digits inside string values are left alone. In
// this domain the only >=16-digit integers are ids (counts/timestamps are
// smaller), and ids are consumed as strings everywhere, so this is safe.

const MAX_SAFE = "9007199254740991"; // 2^53 - 1 (16 digits)

// True iff the unsigned integer `digits` exceeds Number.MAX_SAFE_INTEGER.
function exceedsSafeInteger(digits: string): boolean {
  const d = digits.replace(/^0+/, "") || "0"; // JSON has no leading zeros; defensive
  if (d.length > MAX_SAFE.length) return true;
  if (d.length < MAX_SAFE.length) return false;
  return d > MAX_SAFE; // equal length -> lexicographic == numeric
}

// Wrap every precision-losing integer literal (in value position) in quotes.
// String contents are skipped via an escape-aware in-string scan.
export function requoteBigIntegers(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  let inString = false;
  while (i < n) {
    const c = text[i]!;
    if (inString) {
      if (c === "\\" && i + 1 < n) {
        out += c + text[i + 1]; // copy the escape pair verbatim
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    // A number literal starts with '-' or a digit (only numbers use '-' in JSON).
    if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i;
      if (text[j] === "-") j++;
      const intStart = j;
      while (j < n && text[j]! >= "0" && text[j]! <= "9") j++;
      const intDigits = text.slice(intStart, j);
      let isInteger = true;
      if (text[j] === ".") {
        isInteger = false;
        j++;
        while (j < n && text[j]! >= "0" && text[j]! <= "9") j++;
      }
      if (text[j] === "e" || text[j] === "E") {
        isInteger = false;
        j++;
        if (text[j] === "+" || text[j] === "-") j++;
        while (j < n && text[j]! >= "0" && text[j]! <= "9") j++;
      }
      const token = text.slice(i, j);
      if (isInteger && intDigits.length > 0 && exceedsSafeInteger(intDigits)) {
        out += `"${token}"`; // quote the (possibly negative) oversized integer
      } else {
        out += token;
      }
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function losslessJsonParse(text: string): unknown {
  return JSON.parse(requoteBigIntegers(text));
}
