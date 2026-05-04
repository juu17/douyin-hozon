import React, { useEffect, useRef, useState } from "react";
import { Box, Text, measureElement, useInput, type DOMElement } from "ink";
import { THEME } from "../theme/index.js";

// Self-contained single-line editor with horizontal scrolling so the cursor
// stays in view when the value is longer than the field. Replaced
// ink-text-input because it renders the full value as one Text — when the
// value exceeds the field width, Yoga wraps it onto extra rows and the
// overflow paints over the row below.

interface LineEditorProps {
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
  onSubmit: (value: string) => void;
  focus?: boolean;
}

const BLINK_INTERVAL_MS = 500;

export function LineEditor({
  value,
  placeholder,
  onChange,
  onSubmit,
  focus = true,
}: LineEditorProps): React.JSX.Element {
  const [cursor, setCursor] = useState<number>(value.length);
  // Sensible starting width so we render something on first paint. The
  // parent value box has flexShrink=1 + minWidth=0 + overflow=hidden, so
  // even if this overshoots the actual cell width it gets clipped, not
  // bubbled up as a layout-widening force. measureElement on the next tick
  // narrows it to the real width.
  const [windowWidth, setWindowWidth] = useState<number>(30);
  const [blinkOn, setBlinkOn] = useState<boolean>(true);
  const containerRef = useRef<DOMElement | null>(null);

  // Refs that update synchronously inside the input handler so rapid-fire
  // keystrokes (autorepeat on Backspace/typing) each see the result of the
  // previous keystroke instead of a stale closure-captured value/cursor.
  // setState calls schedule a re-render but don't update what the next
  // handler sees in the same tick — refs do.
  const valueRef = useRef(value);
  const cursorRef = useRef<number>(value.length);
  valueRef.current = value;

  // Hold-Backspace-to-clear: when the user keeps Backspace down for ≥3s
  // (continuous, no gap > 250ms), wipe the field. holdStartRef tracks when
  // the current sustained hold began; lastBackspaceTickRef gates the
  // continuity check.
  const holdStartRef = useRef<number | null>(null);
  const lastBackspaceTickRef = useRef<number>(0);
  const HOLD_CLEAR_MS = 3000;
  const HOLD_GAP_MS = 250;

  // Re-measure only when focus toggles — running on every render caused
  // useless layout work on every keystroke.
  useEffect(() => {
    if (!containerRef.current) return;
    const dims = measureElement(containerRef.current);
    if (dims.width > 0 && dims.width !== windowWidth) setWindowWidth(dims.width);
    // Listen for terminal resize so the window stays in sync.
    const onResize = () => {
      if (!containerRef.current) return;
      const next = measureElement(containerRef.current);
      if (next.width > 0 && next.width !== windowWidth) setWindowWidth(next.width);
    };
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, [focus, windowWidth]);

  useEffect(() => {
    if (!focus) {
      setBlinkOn(true);
      return;
    }
    const id = setInterval(() => setBlinkOn((on) => !on), BLINK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [focus]);

  // Clamp cursor inside the current value (defensive; value can change from outside).
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  cursorRef.current = safeCursor;

  useInput(
    (input, key) => {
      // Read live state from refs — these reflect the cumulative result of
      // any keypresses already processed in this tick.
      let v = valueRef.current;
      let c = cursorRef.current;

      if (key.return) {
        onSubmit(v);
        return;
      }
      if (key.escape) return;          // bubbles to parent for "cancel edit"

      if (key.leftArrow) {
        c = Math.max(0, c - 1);
        cursorRef.current = c;
        setCursor(c);
        return;
      }
      if (key.rightArrow) {
        c = Math.min(v.length, c + 1);
        cursorRef.current = c;
        setCursor(c);
        return;
      }
      if (key.ctrl && input === "a") {
        cursorRef.current = 0;
        setCursor(0);
        return;
      }
      if (key.ctrl && input === "e") {
        cursorRef.current = v.length;
        setCursor(v.length);
        return;
      }
      // Forward delete: Ctrl+D (rare; bound here because key.delete is
      // ambiguous on macOS — see backspace block below).
      if (key.ctrl && input === "d") {
        if (c >= v.length) return;
        v = v.slice(0, c) + v.slice(c + 1);
        valueRef.current = v;
        onChange(v);
        return;
      }

      // Backspace handling — IMPORTANT:
      //   1. macOS Backspace key sends 0x7f, which Ink's parseKeypress maps
      //      to `key.delete = true` (not `key.backspace`). Forward Delete
      //      (Fn+Delete on Mac) sends \x1b[3~ which ALSO maps to
      //      `key.delete = true`. The two are indistinguishable at this
      //      level, so we treat key.delete as Backspace (the common case)
      //      and offer Ctrl+D for the rare forward-delete need.
      //   2. When the OS autorepeats Backspace, the terminal can deliver
      //      multiple bytes (e.g. \x7f\x7f\x7f) in a single stdin chunk.
      //      parseKeypress's exact-match table fails for multi-byte input,
      //      so it returns with name='' and no flags, leaving the raw bytes
      //      in `input`. We count occurrences of 0x7f / 0x08 to apply N
      //      backspaces in one go.
      const rawBackspaces =
        typeof input === "string"
          ? (input.match(/[\x7f\x08]/g)?.length ?? 0)
          : 0;
      const isBackspaceKey = key.backspace || key.delete;
      const totalBackspaces = isBackspaceKey
        ? Math.max(rawBackspaces, 1)
        : rawBackspaces;

      if (totalBackspaces > 0) {
        // Hold-to-clear detection. Continuous = events arriving within
        // HOLD_GAP_MS (autorepeat is ~33 ms on macOS, so this is generous).
        const now = Date.now();
        if (now - lastBackspaceTickRef.current > HOLD_GAP_MS) {
          // Gap too long — treat as a fresh press and reset the timer.
          holdStartRef.current = now;
        }
        lastBackspaceTickRef.current = now;
        const holdMs = now - (holdStartRef.current ?? now);

        if (holdMs >= HOLD_CLEAR_MS && v.length > 0) {
          v = "";
          c = 0;
          valueRef.current = v;
          cursorRef.current = c;
          onChange(v);
          setCursor(c);
          // Reset so the user can hold again to clear after re-typing.
          holdStartRef.current = null;
          lastBackspaceTickRef.current = 0;
          return;
        }

        let workV = v;
        let workC = c;
        for (let i = 0; i < totalBackspaces && workC > 0; i++) {
          workV = workV.slice(0, workC - 1) + workV.slice(workC);
          workC -= 1;
        }
        if (workC !== c) {
          v = workV;
          c = workC;
          valueRef.current = v;
          cursorRef.current = c;
          onChange(v);
          setCursor(c);
        }
        return;
      }

      if (key.ctrl || key.meta) return;
      // Tab/up/down don't belong to a single-line editor.
      if (key.tab || key.upArrow || key.downArrow) return;

      if (typeof input === "string" && input.length > 0) {
        // Strip every control byte (incl. residual 0x7f / 0x08 / ANSI escape
        // remainders) from the typed text. Newlines collapse to spaces so a
        // multi-line paste lands as one line.
        const cleaned = input
          .replace(/\r\n|\r|\n/g, " ")
          .replace(/[\x00-\x1f\x7f]/g, "");
        if (cleaned.length === 0) return;
        // Any non-backspace input ends the current hold-to-clear timer.
        holdStartRef.current = null;
        lastBackspaceTickRef.current = 0;
        v = v.slice(0, c) + cleaned + v.slice(c);
        c = c + cleaned.length;
        valueRef.current = v;
        cursorRef.current = c;
        onChange(v);
        setCursor(c);
      }
    },
    { isActive: focus },
  );

  // Empty value + placeholder, no editing → render hint.
  if (value.length === 0 && placeholder && !focus) {
    return (
      <Box ref={containerRef} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        <Text color={THEME.hint} italic wrap="truncate-end">
          {placeholder}
        </Text>
      </Box>
    );
  }

  // Compute the visible window. Keep the cursor on screen, preferring to push
  // the visible window left so the user sees what they just typed.
  const visibleWidth = Math.max(1, windowWidth);
  let start = 0;
  if (value.length + 1 > visibleWidth) {
    // Cursor slot needs room (we render cursor as either a char in value or a
    // trailing space). Bias so the cursor sits at the right edge while typing
    // toward the end, but never lets the cursor scroll off the visible window.
    start = Math.max(0, safeCursor - visibleWidth + 1);
  }
  const end = Math.min(value.length, start + visibleWidth);
  const window = value.slice(start, end);
  const cursorInWindow = safeCursor - start;

  // Build the display: chars before cursor, the cursor cell, chars after.
  // When the cursor is past the last char (typing at end), use a trailing
  // space as the cursor cell. The cursor cell uses the theme primary as
  // background + bold text so it's unambiguously a cursor across themes;
  // it blinks by alternating between the primary-colored cell and the bare
  // char beneath. When focus is lost, no cursor at all.
  const showCursor = focus && blinkOn;
  const before = window.slice(0, cursorInWindow);
  const cursorChar =
    cursorInWindow < window.length ? window[cursorInWindow]! : " ";
  const after = window.slice(cursorInWindow + 1);

  // Box uses flex sizing instead of width="100%" so the inner Text's
  // intrinsic width never propagates up to widen the parent panel. The
  // overflow="hidden" clips any one-frame slice overshoot before the next
  // measureElement re-render corrects it.
  return (
    <Box ref={containerRef} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
      <Text>
        {before}
        {focus ? (
          showCursor ? (
            <Text backgroundColor={THEME.primary} color={THEME.text} bold>
              {cursorChar}
            </Text>
          ) : (
            cursorChar
          )
        ) : (
          cursorChar
        )}
        {after}
      </Text>
    </Box>
  );
}
