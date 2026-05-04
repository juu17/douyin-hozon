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
    <Dialog title={alert.title} width={72} height={9}>
      <Box flexDirection="column" flexGrow={1}>
        <Text color={THEME.text}>{alert.message}</Text>
      </Box>
      <Box justifyContent="flex-end">
        <Button label="OK" focused enabled />
      </Box>
    </Dialog>
  );
}
