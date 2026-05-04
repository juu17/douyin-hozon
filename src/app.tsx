import React, { useEffect } from "react";
import { Box, useApp, useInput, useStdout } from "ink";
import { bootstrapProjectConfig, resolvePaths } from "./downloader.js";
import { ModeList } from "./components/mode-list.js";
import { TaskForm } from "./components/task-form.js";
import { Footer } from "./components/footer.js";
import { CommandPalette } from "./components/command-palette.js";
import { SettingsDialog } from "./components/settings-dialog.js";
import { AlertDialog } from "./components/alert-dialog.js";
import { useStore } from "./state/store.js";
import { useUrlResolver } from "./state/use-url-resolver.js";

export function App() {
  const { state, dispatch } = useStore();
  const { exit } = useApp();
  const { stdout } = useStdout();

  // Auto-extract + auto-resolve any URL value in the store. Runs in the
  // background; surfaces progress via SET_STATUS.
  useUrlResolver();

  useEffect(() => {
    let cancelled = false;
    let revertTimer: ReturnType<typeof setTimeout> | null = null;
    const paths = resolvePaths(process.cwd());
    bootstrapProjectConfig(paths.projectRoot, paths.downloaderRoot)
      .then((startup) => {
        if (cancelled) return;
        if (startup.values && Object.keys(startup.values).length > 0) {
          dispatch({ type: "MERGE_VALUES", values: startup.values });
        }
        if (startup.modeId) {
          dispatch({ type: "SET_MODE", modeId: startup.modeId });
        }
        dispatch({ type: "SET_STATUS", status: startup.status });
        revertTimer = setTimeout(() => {
          if (cancelled) return;
          dispatch({ type: "SET_STATUS", status: "Idle" });
        }, 3000);
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Startup config failed";
        dispatch({ type: "SET_STATUS", status: message });
      });
    return () => {
      cancelled = true;
      if (revertTimer) clearTimeout(revertTimer);
    };
  }, [dispatch]);

  useInput(
    (input, key) => {
      if (state.dialog !== "none") return;
      if (state.editingFieldId !== null) return;

      if (input === "q" || (key.ctrl && input === "c")) {
        exit();
        return;
      }
      if (input === "/") {
        dispatch({ type: "OPEN_DIALOG", dialog: "commands" });
        return;
      }
      // Tab ownership:
      //   - MODE focused → App handles Tab and moves focus to TASK.
      //   - TASK focused → TaskForm owns Tab (cycles between fields and the
      //     Download row). We deliberately do NOT toggle panel focus here, or
      //     a single Tab would both swap panels AND change taskIndex.
      //   - Shift+Tab from TASK is the explicit "back to MODE" gesture.
      if (key.tab) {
        if (key.shift) {
          if (state.panelFocus === "task") {
            dispatch({ type: "FOCUS_PANEL", panel: "mode" });
          }
        } else if (state.panelFocus === "mode") {
          dispatch({ type: "FOCUS_PANEL", panel: "task" });
        }
        return;
      }
      if (key.escape && state.panelFocus === "task") {
        dispatch({ type: "FOCUS_PANEL", panel: "mode" });
      }
    },
    { isActive: true },
  );

  const rows = stdout?.rows ?? 24;
  const cols = stdout?.columns ?? 80;
  const bodyHeight = Math.max(rows - 2, 8);
  const isModal = state.dialog !== "none";

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Box flexDirection="row" height={bodyHeight} paddingX={1} paddingTop={1}>
        {isModal ? (
          <ModalLayer />
        ) : (
          <>
            <ModeList />
            <Box width={2} />
            <TaskForm />
          </>
        )}
      </Box>
      <Footer />
    </Box>
  );
}

function ModalLayer() {
  const { state } = useStore();
  if (state.dialog === "alert") return <AlertDialog />;
  if (state.dialog === "settings") return <SettingsDialog />;
  if (state.dialog === "commands") return <CommandPalette />;
  return null;
}
