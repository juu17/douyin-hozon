import React from "react";
import { Box, Text } from "ink";
import { THEME } from "../theme/index.js";

interface ButtonProps {
  label: string;
  focused: boolean;
  enabled?: boolean;
}

export function Button({ label, focused, enabled = true }: ButtonProps) {
  const borderColor = enabled ? THEME.primary : THEME.borderInactive;
  const fg = focused ? THEME.text : enabled ? THEME.primary : THEME.label;
  const bg = focused ? THEME.primary : undefined;
  return (
    <Box borderStyle="single" borderColor={borderColor} paddingX={1}>
      <Text color={fg} backgroundColor={bg} bold={focused}>
        {label}
      </Text>
    </Box>
  );
}
