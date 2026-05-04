import React from "react";
import { Box, Text, useStdout } from "ink";
import { THEME } from "../theme/index.js";

interface DialogProps {
  title: string;
  width?: number;
  height?: number;
  children: React.ReactNode;
}

export function Dialog({ title, width, height, children }: DialogProps) {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const rows = stdout.rows ?? 24;
  const targetWidth = Math.min(width ?? Math.floor(cols * 0.7), cols - 4);
  const targetHeight = height === undefined ? undefined : Math.min(height, rows - 2);

  return (
    <Box width="100%" height="100%" alignItems="center" justifyContent="center">
      <Box
        flexDirection="column"
        width={targetWidth}
        height={targetHeight}
        borderStyle="single"
        borderColor={THEME.primary}
      >
        <Box marginTop={-1} flexDirection="row" justifyContent="space-between" paddingX={1}>
          <Text color={THEME.primary}> {title} </Text>
          <Text color={THEME.hint}> esc </Text>
        </Box>
        <Box flexDirection="column" paddingX={2} paddingY={1} flexGrow={1}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
