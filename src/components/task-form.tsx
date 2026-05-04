import React from "react";
import { Box, Text, useInput } from "ink";
import { getMode, getTaskFields } from "../modes.js";
import { useStore } from "../state/store.js";
import { useDownloader } from "../state/use-downloader.js";
import { THEME } from "../theme/index.js";
import { Button } from "./button.js";
import { Field } from "./field.js";
import { Panel } from "./panel.js";

export function TaskForm() {
  const { state, dispatch } = useStore();
  const focused = state.panelFocus === "task";
  const downloader = useDownloader();

  const fields = getTaskFields(state.modeId, state.values);
  const mode = getMode(state.modeId);
  const downloadRowIndex = fields.length;
  const totalRows = fields.length + 1;
  const taskIndex = Math.min(state.taskIndex, totalRows - 1);
  const editing = state.editingFieldId !== null;

  useInput(
    (input, key) => {
      if (editing) {
        if (key.escape) {
          dispatch({ type: "STOP_EDIT" });
        }
        return;
      }

      if (key.upArrow) {
        dispatch({ type: "SET_TASK_INDEX", index: (taskIndex - 1 + totalRows) % totalRows });
        return;
      }
      if (key.downArrow) {
        dispatch({ type: "SET_TASK_INDEX", index: (taskIndex + 1) % totalRows });
        return;
      }
      if (key.tab && !key.shift) {
        if (taskIndex === downloadRowIndex) {
          dispatch({ type: "SET_TASK_INDEX", index: 0 });
        } else {
          dispatch({ type: "SET_TASK_INDEX", index: downloadRowIndex });
        }
        return;
      }
      if (input === " ") {
        const field = fields[taskIndex];
        if (field?.kind === "boolean") {
          dispatch({ type: "SET_VALUE", id: field.id, value: !(state.values[field.id] === true) });
        }
        return;
      }
      if (key.return) {
        if (taskIndex === downloadRowIndex) {
          void downloader.launch();
          return;
        }
        const field = fields[taskIndex];
        if (!field) return;
        if (field.kind === "boolean") {
          dispatch({ type: "SET_VALUE", id: field.id, value: !(state.values[field.id] === true) });
          return;
        }
        if (field.kind === "text" || field.kind === "number") {
          dispatch({ type: "START_EDIT", id: field.id });
        }
      }
    },
    { isActive: focused && state.dialog === "none" },
  );

  return (
    <Panel title="TASK" focused={focused} flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color={THEME.text} bold wrap="truncate-end">
          {mode.title}
        </Text>
        <Text color={THEME.label} wrap="truncate-end">{mode.description}</Text>
      </Box>
      <Box flexDirection="column" flexShrink={1} overflow="hidden">
        {fields.map((field, idx) => {
          const active = focused && idx === taskIndex;
          const isEditing = state.editingFieldId === field.id;
          return (
            <Field
              key={field.id}
              def={field}
              value={state.values[field.id] ?? ""}
              active={active}
              editing={isEditing}
              onCommit={(next) => {
                dispatch({ type: "SET_VALUE", id: field.id, value: next });
                dispatch({ type: "STOP_EDIT" });
              }}
            />
          );
        })}
      </Box>
      <Box marginTop={1} justifyContent="flex-end">
        <Button label="Download" focused={focused && taskIndex === downloadRowIndex} enabled={!state.downloadActive} />
      </Box>
    </Panel>
  );
}
