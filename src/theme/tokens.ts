export const THEME = {
  primary: "#5889EE",
  panel: "#353635",
  editSurface: "#333333",
  text: "#FFFFFF",
  label: "#A6A6A6",
  borderInactive: "#2F4C85",
  success: "#67D28A",
  warning: "#F2C14E",
  error: "#E86868",
  hint: "#8D8D8D",
} as const;

export const GLYPHS = {
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  // Mode-list "currently selected" chevron — a chevron/arrow reads as
  // "cursor is here" instead of "this is toggled on" (which ▣ implied).
  modeSelected: "❯",
  // Matched circle pair (Vercel CLI / Inquirer / prompts convention).
  // Both glyphs share the same design grid so widths + stroke weights align.
  checkboxOn: "◉",
  checkboxOff: "◯",
  success: "✓",
  warning: "△",
  separator: "·",
} as const;
