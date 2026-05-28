// Native port of utils/validators.py::sanitize_filename — W2.2.
// Tracked in vendor-api/tally.json; `pnpm vendor:check` flags drift.
//
// Faithful translation. Two traps handled:
//  - Python len()/slice are by CODE POINT; JS .length/.slice are by UTF-16
//    code unit. Emoji and astral CJK would mis-count, so the length cap uses
//    Array.from (code-point array) + join.
//  - Python str.strip('._- ') / rstrip strip ANY char in the SET from the
//    ends (not the substring), so it's a char-class regex, with the hyphen
//    escaped inside the class.
//
// On whitespace: JS regex `\s` matches the same set we need here — by the time
// the [\s_]+ collapse runs, all control chars (incl. \t \n \r \v \f, which are
// in \x00-\x1f) have already become "_", and JS `\s` covers the survivors:
// space, NBSP ( ), and the Unicode Zs separators including ideographic
// space 　 (common in CJK titles). See the 　 test vector.

const STRIP_SET_BOTH = /^[._\- ]+|[._\- ]+$/g;
const STRIP_SET_END = /[._\- ]+$/;

export function sanitizeFilename(filename: string, maxLength = 80): string {
  // 1. newline/carriage-return -> space (BEFORE the whitespace collapse)
  let s = filename.replace(/\n/g, " ").replace(/\r/g, " ");
  // 2. Windows-illegal chars + '#' + control chars -> '_'
  s = s.replace(/[<>:"/\\|?*#\x00-\x1f]/g, "_");
  // 3. runs of whitespace/underscore -> single '_'
  s = s.replace(/[\s_]+/g, "_");
  // 4. strip the set {. _ - space} from both ends
  s = s.replace(STRIP_SET_BOTH, "");
  // 5. cap at maxLength CODE POINTS, then rstrip the set again
  const cps = Array.from(s);
  if (cps.length > maxLength) {
    s = cps.slice(0, maxLength).join("").replace(STRIP_SET_END, "");
  }
  return s || "untitled";
}
