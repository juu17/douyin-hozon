import React, { useState } from "react";
import { Box, Text } from "ink";
import { GLYPHS, THEME } from "../theme/index.js";
import type { FieldDefinition } from "../modes.js";
import { LineEditor } from "./line-editor.js";

interface FieldProps {
  def: FieldDefinition;
  value: string | boolean;
  active: boolean;
  editing: boolean;
  labelWidth?: number;
  onCommit: (next: string | boolean) => void;
}

const DEFAULT_LABEL_WIDTH = 24;
// Sub-label column inside the value cell for kind: "cookie". Wide enough for
// "passport_csrf_token" (19 chars) + breathing room.
const COOKIE_SUBLABEL_WIDTH = 21;

export function Field({ def, value, active, editing, labelWidth = DEFAULT_LABEL_WIDTH, onCommit }: FieldProps) {
  const labelColor = active ? THEME.text : THEME.label;
  const labelBg = active ? THEME.primary : undefined;
  const valueBg = active ? THEME.editSurface : undefined;

  return (
    <Box flexDirection="row" height={1} width="100%" overflow="hidden">
      <Box width={labelWidth} flexShrink={0}>
        <Text color={labelColor} backgroundColor={labelBg} bold={active}>
          {pad(def.label, labelWidth)}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0} paddingLeft={1} overflow="hidden">
        <FieldValue def={def} value={value} editing={editing} valueBg={valueBg} onCommit={onCommit} />
      </Box>
    </Box>
  );
}

interface FieldValueProps {
  def: FieldDefinition;
  value: string | boolean;
  editing: boolean;
  valueBg: string | undefined;
  onCommit: (next: string | boolean) => void;
}

function FieldValue({ def, value, editing, valueBg, onCommit }: FieldValueProps) {
  if (editing && (def.kind === "text" || def.kind === "number")) {
    return <FieldEditor def={def} value={String(value ?? "")} onCommit={onCommit} valueBg={valueBg} />;
  }

  // Cookie-cluster row, editing: [sub-label 21] [LineEditor].
  if (editing && def.kind === "cookie") {
    return (
      <Box flexDirection="row" minWidth={0} flexGrow={1}>
        <Box width={COOKIE_SUBLABEL_WIDTH} flexShrink={0}>
          <Text color={THEME.label} backgroundColor={valueBg}>
            {pad(def.subLabel ?? "", COOKIE_SUBLABEL_WIDTH)}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <FieldEditor def={def} value={String(value ?? "")} onCommit={onCommit} valueBg={valueBg} />
        </Box>
      </Box>
    );
  }

  if (def.kind === "boolean") {
    const on = value === true;
    const label = on ? `${GLYPHS.checkboxOn} Enabled` : `${GLYPHS.checkboxOff} Disabled`;
    return (
      <Text color={THEME.text} backgroundColor={valueBg} wrap="truncate-end">
        {label}
      </Text>
    );
  }

  if (def.kind === "path-toggle") {
    // Same visual contract as boolean but the option name (e.g. "author_name")
    // is the right-hand label — the four toggles cluster under one
    // "Path Preference" label rendered by the first row.
    const on = value === true;
    const optionLabel = def.option ?? "";
    const label = on ? `${GLYPHS.checkboxOn} ${optionLabel}` : `${GLYPHS.checkboxOff} ${optionLabel}`;
    return (
      <Text color={THEME.text} backgroundColor={valueBg} wrap="truncate-end">
        {label}
      </Text>
    );
  }

  // Cookie-cluster row, read-only: sub-label (cookie name) then the value or
  // an empty-hint placeholder. The shared "Cookies" outer label is rendered by
  // the first row's normal Field label slot — the other 4 rows have label "".
  if (def.kind === "cookie") {
    const sub = def.subLabel ?? "";
    const text = String(value ?? "");
    const showPlaceholder = text.trim().length === 0;
    return (
      <Box flexDirection="row" minWidth={0} overflow="hidden">
        <Box width={COOKIE_SUBLABEL_WIDTH} flexShrink={0}>
          <Text color={THEME.label} backgroundColor={valueBg}>
            {pad(sub, COOKIE_SUBLABEL_WIDTH)}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Text
            color={showPlaceholder ? THEME.hint : THEME.text}
            backgroundColor={valueBg}
            italic={showPlaceholder}
            wrap="truncate-end"
          >
            {showPlaceholder ? "empty" : text}
          </Text>
        </Box>
      </Box>
    );
  }

  if (def.kind === "readonly") {
    return (
      <Text color={THEME.text} backgroundColor={valueBg} wrap="truncate-end">
        {String(value ?? "")}
      </Text>
    );
  }

  const text = String(value ?? "");
  if (text.trim().length === 0) {
    return (
      <Text color={THEME.hint} backgroundColor={valueBg} italic wrap="truncate-end">
        {def.placeholder ?? "empty"}
      </Text>
    );
  }
  return (
    <Text color={THEME.text} backgroundColor={valueBg} wrap="truncate-end">
      {text}
    </Text>
  );
}

function FieldEditor({
  def,
  value,
  onCommit,
}: {
  def: FieldDefinition;
  value: string;
  onCommit: (next: string | boolean) => void;
  valueBg: string | undefined;
}) {
  const [draft, setDraft] = useState(value);
  // No wrapper Box: an unsized Box between the flex-shrinkable value cell
  // and the LineEditor breaks the flex chain (its intrinsic width
  // propagates up). LineEditor renders its own properly-shrinkable Box.
  return (
    <LineEditor
      value={draft}
      placeholder={def.placeholder}
      onChange={(next) => {
        if (def.kind === "number") {
          // Allow optional leading "-" then digits. Useful for offsets and
          // future fields; today's numeric fields treat 0 as the only
          // sentinel but a negative would be visually distinguishable.
          const cleaned = next.replace(/[^0-9-]/g, "").replace(/(?!^)-/g, "");
          setDraft(cleaned);
          return;
        }
        setDraft(next);
      }}
      onSubmit={(submitted) => {
        // Per-field synchronous transform (e.g. URL fields strip share-text
        // noise around the actual URL). Falls back to identity.
        const cleaned = def.transform ? def.transform(submitted) : submitted;
        onCommit(cleaned);
      }}
    />
  );
}

function pad(input: string, width: number): string {
  if (input.length >= width) return input.slice(0, width);
  return input + " ".repeat(width - input.length);
}
