import React from "react";
import { Box, Text, useInput } from "ink";
import { MODE_DEFINITIONS } from "../modes.js";
import { useStore } from "../state/store.js";
import { THEME } from "../theme/index.js";
import { Panel } from "./panel.js";

export function ModeList() {
  const { state, dispatch } = useStore();
  const focused = state.panelFocus === "mode";

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        const idx = MODE_DEFINITIONS.findIndex((m) => m.id === state.modeId);
        const next = (idx - 1 + MODE_DEFINITIONS.length) % MODE_DEFINITIONS.length;
        dispatch({ type: "SET_MODE", modeId: MODE_DEFINITIONS[next]!.id });
      } else if (key.downArrow) {
        const idx = MODE_DEFINITIONS.findIndex((m) => m.id === state.modeId);
        const next = (idx + 1) % MODE_DEFINITIONS.length;
        dispatch({ type: "SET_MODE", modeId: MODE_DEFINITIONS[next]!.id });
      } else if (key.return) {
        dispatch({ type: "FOCUS_PANEL", panel: "task" });
      }
    },
    { isActive: focused && state.dialog === "none" && state.editingFieldId === null },
  );

  return (
    <Panel title="MODE" focused={focused} width="40%">
      <Box flexDirection="column">
        {MODE_DEFINITIONS.map((mode) => {
          const selected = mode.id === state.modeId;
          const fg = selected ? THEME.text : THEME.label;
          const bg = selected ? THEME.primary : undefined;
          return (
            <Text key={mode.id} color={fg} backgroundColor={bg} bold={selected} wrap="truncate-end">
              {selected ? " ▣ " : "   "}
              {mode.title}
            </Text>
          );
        })}
      </Box>
    </Panel>
  );
}
