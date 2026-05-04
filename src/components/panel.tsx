import React from "react";
import { Box, Text } from "ink";
import { THEME } from "../theme/index.js";

interface PanelProps {
  title: string;
  focused: boolean;
  flexGrow?: number;
  flexShrink?: number;
  width?: number | string;
  height?: number | string;
  children: React.ReactNode;
}

export function Panel({
  title,
  focused,
  flexGrow,
  flexShrink,
  width,
  height,
  children,
}: PanelProps) {
  // Default: a panel with a fixed `width` is non-shrinkable (so a sibling's
  // long-content max-content can't claw width away from it). A panel using
  // `flexGrow` is the dynamic one — let it absorb the shrinkage.
  const resolvedShrink = flexShrink ?? (width !== undefined ? 0 : 1);

  return (
    <Box
      flexDirection="column"
      flexGrow={flexGrow}
      flexShrink={resolvedShrink}
      minWidth={0}
      width={width}
      height={height}
      borderStyle="single"
      borderColor={focused ? THEME.primary : THEME.borderInactive}
    >
      <Box marginTop={-1} marginLeft={1}>
        <Text color={focused ? THEME.primary : THEME.text}> {title} </Text>
      </Box>
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
}
