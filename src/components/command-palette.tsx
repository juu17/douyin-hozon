import React, { useMemo, useState } from "react";
import { spawn } from "node:child_process";
import path from "node:path";
import { Box, Text, useInput } from "ink";
import { useStore } from "../state/store.js";
import { THEME } from "../theme/index.js";
import { captureChromeDouyinCookies, CookieCaptureError } from "../engine/cookie-capture.js";
import { Dialog } from "./dialog.js";
import { LineEditor } from "./line-editor.js";

interface CommandOption {
  id: "settings" | "open-browser" | "capture-cookies";
  label: string;
  description: string;
}

const COMMAND_OPTIONS: CommandOption[] = [
  { id: "capture-cookies", label: "Capture Cookies", description: "Read douyin cookies from Chrome (zero clicks; macOS + Windows)" },
  { id: "settings", label: "/settings", description: "Open shared and advanced settings" },
  { id: "open-browser", label: "Open Browser", description: "Launch Douyin in your default browser" },
];

function openBrowser(): void {
  const target = "https://www.douyin.com/";
  if (process.platform === "darwin") {
    spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
  }
}

type Dispatch = ReturnType<typeof useStore>["dispatch"];

async function runCaptureCookies(dispatch: Dispatch): Promise<void> {
  dispatch({ type: "SET_COOKIE_CAPTURE_ACTIVE", active: true });
  dispatch({ type: "SET_STATUS", status: "Reading Chrome cookies…" });
  try {
    const result = await captureChromeDouyinCookies();
    dispatch({ type: "SET_COOKIE_JAR", jar: result.jar });
    dispatch({
      type: "SET_STATUS",
      status: `Captured ${result.count} cookies from ${result.hostsSeen.length} hosts`,
    });
    const scanLine = result.scanned
      .filter((s) => s.douyinCookies > 0)
      .map((s) => `${s.name}(${s.douyinCookies})`)
      .join(", ");
    dispatch({
      type: "OPEN_ALERT",
      alert: {
        title: "Cookies Captured",
        message:
          `Read ${result.count} douyin cookies from ${path.basename(result.profile)}.\n` +
          `Hosts: ${result.hostsSeen.join(", ")}\n` +
          `Profiles checked: ${scanLine || "(none with cookies)"}\n\n` +
          `The captured jar overrides the 5 manual cookie fields in /settings.`,
      },
    });
  } catch (error) {
    const message = error instanceof CookieCaptureError
      ? `[${error.code}] ${error.message}`
      : error instanceof Error
        ? error.message
        : "Unknown error";
    dispatch({ type: "SET_STATUS", status: "Capture failed" });
    dispatch({
      type: "OPEN_ALERT",
      alert: { title: "Capture Cookies Failed", message },
    });
  } finally {
    dispatch({ type: "SET_COOKIE_CAPTURE_ACTIVE", active: false });
  }
}

export function CommandPalette() {
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isActive = state.dialog === "commands";

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return COMMAND_OPTIONS;
    return COMMAND_OPTIONS.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) || option.description.toLowerCase().includes(needle),
    );
  }, [query]);

  const safeIndex = Math.min(selectedIndex, Math.max(filtered.length - 1, 0));

  useInput(
    (_input, key) => {
      if (key.escape) {
        dispatch({ type: "CLOSE_DIALOG" });
        return;
      }
      if (key.upArrow) {
        if (filtered.length === 0) return;
        setSelectedIndex((safeIndex - 1 + filtered.length) % filtered.length);
        return;
      }
      if (key.downArrow) {
        if (filtered.length === 0) return;
        setSelectedIndex((safeIndex + 1) % filtered.length);
      }
    },
    { isActive },
  );

  if (!isActive) return null;

  const runOption = (option: CommandOption): void => {
    dispatch({ type: "CLOSE_DIALOG" });
    if (option.id === "settings") {
      dispatch({ type: "OPEN_DIALOG", dialog: "settings" });
      return;
    }
    if (option.id === "open-browser") {
      openBrowser();
      dispatch({ type: "SET_STATUS", status: "Opened browser" });
      return;
    }
    if (option.id === "capture-cookies") {
      void runCaptureCookies(dispatch);
    }
  };

  return (
    <Dialog title="COMMANDS" width={84} height={18}>
      <Box flexDirection="column">
        <Box>
          <Text color={THEME.label}>{"› "}</Text>
          <LineEditor
            value={query}
            placeholder="Search commands"
            onChange={(next) => {
              setQuery(next);
              setSelectedIndex(0);
            }}
            onSubmit={() => {
              const option = filtered[safeIndex];
              if (option) runOption(option);
            }}
          />
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {filtered.length === 0 ? (
            <Text color={THEME.hint}>No commands found</Text>
          ) : (
            filtered.map((option, idx) => {
              const active = idx === safeIndex;
              return (
                <Box key={option.id}>
                  <Text color={active ? THEME.text : THEME.text} backgroundColor={active ? THEME.primary : undefined} bold={active}>
                    {" " + option.label + "  "}
                  </Text>
                  <Text color={THEME.hint} backgroundColor={active ? THEME.primary : undefined}>
                    {option.description + " "}
                  </Text>
                </Box>
              );
            })
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
