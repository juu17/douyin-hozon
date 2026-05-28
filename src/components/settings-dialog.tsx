import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { getSettingsFields, type ValueMap } from "../modes.js";
import { useStore } from "../state/store.js";
import { THEME } from "../theme/index.js";
import { Button } from "./button.js";
import { Dialog } from "./dialog.js";
import { Field } from "./field.js";

type FocusArea = "fields" | "save";

// Settings field id -> cookieJar key. The "/" Capture-Cookies command writes
// into cookieJar with douyin's snake_case keys, while the manual-override
// fields in Settings use camelCase ids — without this map the captured values
// looked "empty" in Settings even after a successful capture.
const COOKIE_FALLBACK_KEY: Record<string, string> = {
  msToken: "msToken",
  ttwid: "ttwid",
  odin_tt: "odin_tt",
  passportCsrfToken: "passport_csrf_token",
  sidGuard: "sid_guard",
};

export function SettingsDialog() {
  const { state, dispatch } = useStore();
  const isActive = state.dialog === "settings";
  const [draft, setDraft] = useState<ValueMap>(state.values);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focusArea, setFocusArea] = useState<FocusArea>("fields");
  const [editingId, setEditingId] = useState<string | null>(null);

  const fields = useMemo(() => getSettingsFields(state.modeId, draft), [state.modeId, draft]);
  const safeIndex = Math.min(selectedIndex, Math.max(fields.length - 1, 0));

  useInput(
    (input, key) => {
      if (editingId) {
        if (key.escape) setEditingId(null);
        return;
      }
      if (key.escape) {
        dispatch({ type: "CLOSE_DIALOG" });
        return;
      }
      if (key.tab) {
        setFocusArea((prev) => (prev === "fields" ? "save" : "fields"));
        return;
      }
      if (focusArea === "fields") {
        if (key.upArrow) {
          if (fields.length === 0) return;
          setSelectedIndex((safeIndex - 1 + fields.length) % fields.length);
          return;
        }
        if (key.downArrow) {
          if (fields.length === 0) return;
          setSelectedIndex((safeIndex + 1) % fields.length);
          return;
        }
        if (input === " ") {
          const field = fields[safeIndex];
          if (field?.kind === "boolean" || field?.kind === "path-toggle") {
            setDraft((prev) => mergeBoolean(prev, field.id));
          }
          return;
        }
        if (key.return) {
          const field = fields[safeIndex];
          if (!field) return;
          if (field.kind === "boolean" || field.kind === "path-toggle") {
            setDraft((prev) => mergeBoolean(prev, field.id));
            return;
          }
          if (field.kind === "text" || field.kind === "number" || field.kind === "cookie") {
            setEditingId(field.id);
          }
        }
        return;
      }
      if (focusArea === "save" && key.return) {
        dispatch({ type: "MERGE_VALUES", values: draft });
        dispatch({ type: "CLOSE_DIALOG" });
      }
    },
    { isActive },
  );

  if (!isActive) return null;

  return (
    <Dialog title="SETTINGS" width={84} height={28}>
      <Box flexDirection="column" flexGrow={1}>
        {fields.map((field, idx) => {
          const active = focusArea === "fields" && idx === safeIndex;
          const editing = editingId === field.id;
          // For the 5 cookie fields, fall back to the captured cookieJar value
          // when the user hasn't typed an override. Field renders it as a real
          // value (not a placeholder), so a successful capture is visible.
          let value: string | boolean = draft[field.id] ?? "";
          if (value === "" && COOKIE_FALLBACK_KEY[field.id]) {
            const captured = state.cookieJar?.[COOKIE_FALLBACK_KEY[field.id]!];
            if (captured) value = captured;
          }
          return (
            <Field
              key={field.id}
              def={field}
              value={value}
              active={active}
              editing={editing}
              onCommit={(next) => {
                setDraft((prev) => ({ ...prev, [field.id]: next }));
                setEditingId(null);
              }}
            />
          );
        })}
      </Box>
      <Box justifyContent="flex-end" marginTop={1}>
        <Button label="Save Settings" focused={focusArea === "save"} enabled />
      </Box>
      <Box marginTop={1}>
        <Text color={THEME.hint}>tab switch · enter edit/save · space toggle · esc close</Text>
      </Box>
    </Dialog>
  );
}

function mergeBoolean(prev: ValueMap, id: string): ValueMap {
  return { ...prev, [id]: !(prev[id] === true) };
}
