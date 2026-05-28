import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "../../src/engine/native/sanitize.js";

// Expected values derived against the Python (validators.sanitize_filename).
type Case = { in: string; max?: number; out: string; note?: string };

const cases: Case[] = [
  { in: "Hello World", out: "Hello_World" },
  { in: "Hello\nWorld", out: "Hello_World", note: "newline -> space -> collapse" },
  { in: "文件名.txt", out: "文件名.txt", note: "BMP CJK + '.' are kept ('.' is not illegal)" },
  { in: "Title👍test", out: "Title👍test", note: "emoji is neither whitespace nor illegal -> KEPT" },
  { in: 'test<>:"/\\|?*#file', out: "test_file", note: "all illegal -> _ -> collapse" },
  { in: "...___   ---", out: "untitled", note: "every char in the strip set -> empty -> untitled" },
  { in: "", out: "untitled" },
  { in: "filename______", out: "filename", note: "trailing underscores collapse then strip" },
  { in: "中文标题_____", out: "中文标题" },
  { in: "title\x00\x01\x1f", out: "title", note: "control chars -> _ -> collapse -> strip" },
  { in: " - . _ leading_stuff", out: "leading_stuff" },
  { in: "end_stuff . - _ ", out: "end_stuff" },
  { in: "a　b", out: "a_b", note: "U+3000 ideographic space IS matched by JS \\s" },
  { in: "x y", out: "x_y", note: "U+00A0 NBSP IS matched by JS \\s" },
  { in: "abcdefgh__xyz", max: 9, out: "abcdefgh", note: "cut to 9 cp ('abcdefgh_') then rstrip the _" },
  { in: "aaaaaaaa", max: 5, out: "aaaaa", note: "plain length cap" },
  { in: "名前.pdf", out: "名前.pdf" },
];

describe("sanitizeFilename (vendor parity)", () => {
  for (const c of cases) {
    const label = `${JSON.stringify(c.in)}${c.max ? ` @${c.max}` : ""}${c.note ? ` — ${c.note}` : ""}`;
    it(label, () => {
      expect(sanitizeFilename(c.in, c.max ?? 80)).toBe(c.out);
    });
  }
});
