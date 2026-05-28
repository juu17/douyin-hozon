import React from "react";
import { Box, Text, useInput } from "ink";
import { useStore } from "../state/store.js";
import { THEME } from "../theme/index.js";
import { Button } from "./button.js";
import { Dialog } from "./dialog.js";

export function AlertDialog() {
  const { state, dispatch } = useStore();
  const alert = state.alert;

  useInput(
    (_input, key) => {
      if (key.escape || key.return) {
        dispatch({ type: "CLOSE_DIALOG" });
      }
    },
    { isActive: state.dialog === "alert" },
  );

  if (!alert) return null;

  return (
    // No fixed height — alert content varies (one line for "Validation Error",
    // ~7 lines for "Cookies Captured"). A fixed height pushed the OK button
    // past the right border once the message exceeded the content area.
    <Dialog title={alert.title} width={72}>
      <Box flexDirection="column">
        <Text color={THEME.text}>{alert.message}</Text>
      </Box>
      <Box justifyContent="flex-end" marginTop={1}>
        <Button label="OK" focused enabled />
      </Box>
    </Dialog>
  );
}
