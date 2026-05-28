# Backlog

Follow-up items left open. Not blockers — the TUI ships and runs without them. Listed in rough priority order.

## 1. Mouse support

**Status**: not wired. Ink does not ship first-class mouse; the previous blessed implementation supported click-to-focus and click-outside-dismiss.

**Why**: matches opencode-style keyboard-first UX in the meantime, but loses parity with the prior build for users who reach for the mouse.

**Sketch**: write a small parser for ANSI mouse escape sequences (`\x1b[<...M`) on `process.stdin` and dispatch store actions (`SET_TASK_INDEX`, `FOCUS_PANEL`, `CLOSE_DIALOG` for outside-clicks). Enable with `process.stdout.write('\x1b[?1000h\x1b[?1006h')` on mount; disable on unmount. Likely lives in a new `src/state/use-mouse.ts`. Components opt in by reading mouse coordinates from a context, OR map row index to position via refs.

**Effort**: ~half a day.

## 2. `Ctrl+A` / `Ctrl+E` in line editor — RESOLVED

**Status**: closed. We dropped `ink-text-input` and now own the line editor
end-to-end ([src/components/line-editor.tsx](src/components/line-editor.tsx)).
Ctrl+A jumps to start, Ctrl+E to end. Ctrl+D is bound to forward-delete
(macOS Backspace = `key.delete` is treated as Backspace, so we needed an
explicit forward-delete binding). Hold-Backspace-3s also clears the field.

## 3. Rich progress integration — RESOLVED (Phase E cutover)

**Status**: closed. Phase E removed the upstream-CLI subprocess entirely. The
v2 engine emits its own structured `ProgressEvent` stream from
[src/engine/progress.ts](src/engine/progress.ts) (`stage`, `page`, `item-start`,
`item-bytes`, `item-skip`, `item-done`, `summary`) and the [Footer](src/components/footer.tsx)
spinner now reflects live download state.

What's still pending: a richer multi-line progress widget (per-item filename,
overall bar, ETA). The structured events are already there — only the UI
surface is minimal. ~half a day of UI work when wanted.

## 4. Test coverage with `ink-testing-library`

**Status**: zero tests. The Ink migration unlocks `ink-testing-library` (snapshot testing of rendered output), but no tests have been written yet.

**Why**: regressions on focus state, dialog chrome, and field rendering are exactly the kind of thing snapshot tests catch cheaply. The previous blessed-based code couldn't be tested at all.

**Sketch**: add `ink-testing-library` and `vitest` (or `node --test`) as devDependencies. First-pass targets:
- Snapshot per mode of `<TaskForm>` rendered with default values.
- `<Dialog>` chrome consistency (settings, alert, command palette should produce visually-equivalent borders/title placement).
- Focus rotation: simulate Tab, assert `panelFocus` flips.
- Reducer: pure function, easy unit tests for SET_VALUE / MERGE_VALUES / OPEN_DIALOG.

**Effort**: ~half a day to bootstrap, ongoing.

## 5. Settings dialog draft persistence

**Status**: [src/components/settings-dialog.tsx](src/components/settings-dialog.tsx) keeps `draft` in local component state; closing without "Save Settings" discards unsaved edits. Behavior matches the previous blessed implementation but is a bit footgun-y.

**Why**: a user who tabs into Settings, edits a long Proxy URL, then hits Esc out of habit loses the entry silently.

**Sketch**: either (a) lift `draft` into the store as `settingsDraft`, persist across open/close, only commit on save; or (b) prompt-on-discard with a confirmation step; or (c) auto-save on every keystroke and remove the explicit Save button entirely (matches modern web settings UX). Option (c) is probably the right answer since `values` is in-memory anyway — disk is only touched when the downloader runs.

**Effort**: ~2 hours.

