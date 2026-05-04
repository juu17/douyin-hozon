import React, { createContext, useContext, useMemo, useReducer } from "react";
import { createInitialValues, MODE_DEFINITIONS, type ModeId, type ValueMap } from "../modes.js";

export type PanelFocus = "mode" | "task";

export type DialogKind = "none" | "settings" | "commands" | "alert";

export interface AlertPayload {
  title: string;
  message: string;
}

export interface AppState {
  modeId: ModeId;
  values: ValueMap;
  panelFocus: PanelFocus;
  taskIndex: number;
  editingFieldId: string | null;
  dialog: DialogKind;
  alert: AlertPayload | null;
  // When a dialog opens "on top of" another (e.g. an alert pops while
  // settings is open), this remembers what to return to on close.
  dialogStack: Exclude<DialogKind, "none">[];
  status: string;
  downloadActive: boolean;
  // True while the Capture-Cookies pipeline is running. Treated as a soft
  // mutex: Download blocks while this is true so an empty cookieJar can't
  // sneak through before capture finishes.
  cookieCaptureActive: boolean;
  cookieJar: Record<string, string> | null;   // populated by Capture Cookies
}

export type Action =
  | { type: "SET_MODE"; modeId: ModeId }
  | { type: "SET_VALUE"; id: string; value: string | boolean }
  | { type: "MERGE_VALUES"; values: Partial<ValueMap> }
  | { type: "FOCUS_PANEL"; panel: PanelFocus }
  | { type: "SET_TASK_INDEX"; index: number }
  | { type: "START_EDIT"; id: string }
  | { type: "STOP_EDIT" }
  | { type: "OPEN_DIALOG"; dialog: Exclude<DialogKind, "none" | "alert"> }
  | { type: "OPEN_ALERT"; alert: AlertPayload }
  | { type: "CLOSE_DIALOG" }
  | { type: "SET_STATUS"; status: string }
  | { type: "SET_DOWNLOAD_ACTIVE"; active: boolean }
  | { type: "SET_COOKIE_CAPTURE_ACTIVE"; active: boolean }
  | { type: "SET_COOKIE_JAR"; jar: Record<string, string> | null };

export const INITIAL_STATE: AppState = {
  modeId: MODE_DEFINITIONS[0]!.id,
  values: createInitialValues(),
  panelFocus: "mode",
  taskIndex: 0,
  editingFieldId: null,
  dialog: "none",
  alert: null,
  dialogStack: [],
  status: "Idle",
  downloadActive: false,
  cookieCaptureActive: false,
  cookieJar: null,
};

// Single source of truth for the `incremental → useDatabase` invariant.
// Applied by both SET_VALUE and MERGE_VALUES so config-load (which uses
// MERGE_VALUES) and direct toggles produce the same result.
function applyIncrementalRule(values: ValueMap): ValueMap {
  if (values.incremental === true && values.useDatabase !== true) {
    return { ...values, useDatabase: true };
  }
  return values;
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_MODE":
      if (action.modeId === state.modeId) return state;
      // Don't switch modes mid-download — the engine is mid-flight against
      // the current mode's URL field (videoUrl / noteUrl / …) and values.
      // Caller should cancel first.
      if (state.downloadActive) return state;
      return { ...state, modeId: action.modeId, taskIndex: 0, editingFieldId: null };
    case "SET_VALUE": {
      if (state.values[action.id] === action.value) return state;
      const next: ValueMap = { ...state.values };
      next[action.id] = action.value;
      return { ...state, values: applyIncrementalRule(next) };
    }
    case "MERGE_VALUES": {
      const merged: ValueMap = { ...state.values };
      for (const [k, v] of Object.entries(action.values)) {
        if (v !== undefined) merged[k] = v;
      }
      return { ...state, values: applyIncrementalRule(merged) };
    }
    case "FOCUS_PANEL":
      if (state.panelFocus === action.panel) return state;
      return { ...state, panelFocus: action.panel, editingFieldId: null };
    case "SET_TASK_INDEX":
      if (state.taskIndex === action.index) return state;
      return { ...state, taskIndex: action.index };
    case "START_EDIT":
      return { ...state, editingFieldId: action.id };
    case "STOP_EDIT":
      return { ...state, editingFieldId: null };
    case "OPEN_DIALOG": {
      // Push the current dialog onto the stack if there was one, so CLOSE
      // can restore it. (Common case: capture cookies → alert; closing the
      // alert returns to commands palette is undesirable so we don't push
      // commands. Only persistent dialogs — currently `settings` — push.)
      const stack = state.dialog === "settings"
        ? [...state.dialogStack, "settings" as const]
        : state.dialogStack;
      return { ...state, dialog: action.dialog, dialogStack: stack, editingFieldId: null };
    }
    case "OPEN_ALERT": {
      const stack = state.dialog !== "none" && state.dialog !== "alert"
        ? [...state.dialogStack, state.dialog as Exclude<DialogKind, "none">]
        : state.dialogStack;
      return {
        ...state,
        dialog: "alert",
        alert: action.alert,
        dialogStack: stack,
        editingFieldId: null,
      };
    }
    case "CLOSE_DIALOG": {
      // Pop back to the previous dialog if any.
      if (state.dialogStack.length > 0) {
        const stack = state.dialogStack.slice(0, -1);
        const prev = state.dialogStack[state.dialogStack.length - 1]!;
        return { ...state, dialog: prev, alert: null, dialogStack: stack };
      }
      return { ...state, dialog: "none", alert: null, dialogStack: [] };
    }
    case "SET_STATUS":
      if (state.status === action.status) return state;
      return { ...state, status: action.status };
    case "SET_DOWNLOAD_ACTIVE":
      return { ...state, downloadActive: action.active };
    case "SET_COOKIE_CAPTURE_ACTIVE":
      return { ...state, cookieCaptureActive: action.active };
    case "SET_COOKIE_JAR":
      return { ...state, cookieJar: action.jar };
    default:
      return state;
  }
}

interface StoreContext {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const Ctx = createContext<StoreContext | null>(null);

export function StoreProvider({ children, initial }: { children: React.ReactNode; initial?: Partial<AppState> }) {
  const [state, dispatch] = useReducer(reducer, { ...INITIAL_STATE, ...initial });
  const value = useMemo<StoreContext>(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used within <StoreProvider>");
  return ctx;
}
