import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { GLYPHS, THEME } from "../theme/index.js";
import { getMode } from "../modes.js";
import { useStore } from "../state/store.js";

const SPINNER_FRAMES = GLYPHS.spinner;
const SPINNER_INTERVAL_MS = 90;

export function Footer() {
  const { state } = useStore();
  const mode = getMode(state.modeId);
  const frame = useSpinnerFrame(state.downloadActive);

  const statusLower = state.status.toLowerCase();
  const isFailure =
    statusLower.includes("fail") ||
    statusLower.includes("error") ||
    statusLower.includes("denied") ||
    statusLower.startsWith("skip");
  const statusColor = state.downloadActive
    ? THEME.text
    : isFailure
      ? THEME.warning
      : THEME.hint;
  const stateGlyph = state.downloadActive
    ? SPINNER_FRAMES[frame]
    : isFailure
      ? GLYPHS.warning
      : GLYPHS.success;
  const stateGlyphColor = state.downloadActive
    ? THEME.primary
    : isFailure
      ? THEME.warning
      : THEME.hint;

  return (
    <Box flexDirection="row" paddingX={1}>
      <Hint primary="/" muted="commands" />
      <Hint primary="enter" muted="open" />
      <Hint primary="tab" muted="button" />
      <Hint primary="esc" muted="back" />
      <Box flexGrow={1} justifyContent="flex-end">
        <Text color={THEME.primary} wrap="truncate-end">{mode.title}</Text>
        <Text color={stateGlyphColor}>{"  " + stateGlyph + " "}</Text>
        <Text color={statusColor} wrap="truncate-end">{state.status}</Text>
      </Box>
    </Box>
  );
}

function Hint({ primary, muted }: { primary: string; muted: string }) {
  return (
    <Box marginRight={2}>
      <Text color={THEME.text}>{primary}</Text>
      <Text color={THEME.hint}>{" " + muted}</Text>
    </Box>
  );
}

function useSpinnerFrame(active: boolean): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active]);
  return frame;
}
