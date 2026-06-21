import React, { createContext, useContext, useMemo, useReducer } from "react";
import {
  DEFAULT_VALUES,
  isPerModeField,
  MODE_DEFINITIONS,
  PER_MODE_DEFAULTS,
  SHARED_DEFAULTS,
  type ModeId,
  type ValueMap,
} from "../modes.js";

export type PanelFocus = "mode" | "task";

export type DialogKind = "none" | "settings" | "commands" | "alert";

export interface AlertPayload {
  title: string;
  message: string;
}

// CoreState is what the reducer operates on. AppState (below) extends it with
// a DERIVED `values` flat map that's recomputed in the StoreProvider — that
// derived shape is what every component reads, so nothing downstream had to
// change when we split the buckets.
interface CoreState {
  modeId: ModeId;
  // Fields used by every mode (savePath, the include* toggles, thread, proxy,
  // manual cookies, …). One value, applies everywhere.
  shared: Partial<ValueMap>;
  // Each mode's own remembered field values (its URL field, limit, dates).
  // Switching modes restores that mode's bucket without affecting the others.
  byMode: Record<ModeId, Partial<ValueMap>>;
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

// Public shape exposed via context. Consumers continue to read `state.values`;
// `shared` + `byMode` are the source-of-truth buckets and `values` is recomputed
// whenever any of them changes.
export interface AppState extends CoreState {
  values: ValueMap;
}

export type Action =
  | { type: "SET_MODE"; modeId: ModeId }
  | { type: "SET_VALUE"; id: string; value: string | boolean }
  | { type: "MERGE_VALUES"; values: Partial<ValueMap> }
  | {
      type: "LOAD_CONFIG";
      modeId?: ModeId;
      shared?: Partial<ValueMap>;
      byMode?: Partial<Record<ModeId, Partial<ValueMap>>>;
      cookieJar?: Record<string, string> | null;
    }
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

// Recompute the flat `values` map from the per-mode + shared buckets. This is
// the ONE place the back-compat surface is rebuilt; consumers keep reading
// `state.values[id]` without knowing about the split.
function deriveValues(modeId: ModeId, shared: Partial<ValueMap>, byMode: Record<ModeId, Partial<ValueMap>>): ValueMap {
  // DEFAULT_VALUES fully populates every key with a defined value; the Partial
  // overlays only contain DEFINED entries (we never store `undefined`), so the
  // runtime shape always satisfies the ValueMap contract. The cast tells TS
  // about that — spreading Partial into ValueMap otherwise widens to undefined.
  return { ...DEFAULT_VALUES, ...shared, ...(byMode[modeId] ?? {}) } as ValueMap;
}

function withValues(state: AppState): AppState {
  return { ...state, values: deriveValues(state.modeId, state.shared, state.byMode) };
}

const INITIAL_BY_MODE: Record<ModeId, Partial<ValueMap>> = (() => {
  const out = {} as Record<ModeId, Partial<ValueMap>>;
  for (const def of MODE_DEFINITIONS) out[def.id] = { ...PER_MODE_DEFAULTS[def.id] };
  return out;
})();

export const INITIAL_STATE: AppState = withValues({
  modeId: MODE_DEFINITIONS[0]!.id,
  shared: { ...SHARED_DEFAULTS },
  byMode: INITIAL_BY_MODE,
  values: {} as ValueMap, // derived below by withValues
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
});

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_MODE":
      if (action.modeId === state.modeId) return state;
      // Don't switch modes mid-download — the engine is mid-flight against
      // the current mode's URL field (videoUrl / noteUrl / …) and values.
      // Caller should cancel first.
      if (state.downloadActive) return state;
      return withValues({ ...state, modeId: action.modeId, taskIndex: 0, editingFieldId: null });
    case "SET_VALUE": {
      if (state.values[action.id] === action.value) return state;
      if (isPerModeField(action.id)) {
        const cur = state.byMode[state.modeId] ?? {};
        const nextBucket: Partial<ValueMap> = { ...cur, [action.id]: action.value };
        return withValues({ ...state, byMode: { ...state.byMode, [state.modeId]: nextBucket } });
      }
      const nextShared: Partial<ValueMap> = { ...state.shared, [action.id]: action.value };
      return withValues({ ...state, shared: nextShared });
    }
    case "MERGE_VALUES": {
      // Split entries by ownership; only mutate buckets that actually change.
      let sharedDirty = false;
      let bucketDirty = false;
      const nextShared: Partial<ValueMap> = { ...state.shared };
      const curBucket = state.byMode[state.modeId] ?? {};
      const nextBucket: Partial<ValueMap> = { ...curBucket };
      for (const [k, v] of Object.entries(action.values)) {
        if (v === undefined) continue;
        if (isPerModeField(k)) {
          (nextBucket as Record<string, unknown>)[k] = v;
          bucketDirty = true;
        } else {
          (nextShared as Record<string, unknown>)[k] = v;
          sharedDirty = true;
        }
      }
      if (!sharedDirty && !bucketDirty) return state;
      return withValues({
        ...state,
        shared: sharedDirty ? nextShared : state.shared,
        byMode: bucketDirty ? { ...state.byMode, [state.modeId]: nextBucket } : state.byMode,
      });
    }
    case "LOAD_CONFIG": {
      let next = state;
      if (action.modeId && action.modeId !== state.modeId) {
        next = { ...next, modeId: action.modeId, taskIndex: 0, editingFieldId: null };
      }
      if (action.shared) next = { ...next, shared: { ...next.shared, ...action.shared } };
      if (action.byMode) {
        const merged: Record<ModeId, Partial<ValueMap>> = { ...next.byMode };
        for (const [m, vals] of Object.entries(action.byMode)) {
          if (!vals) continue;
          merged[m as ModeId] = { ...(merged[m as ModeId] ?? {}), ...vals };
        }
        next = { ...next, byMode: merged };
      }
      if (action.cookieJar !== undefined) next = { ...next, cookieJar: action.cookieJar };
      return withValues(next);
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
      // When a download ENDS (finish/fail), park the cursor back on the mode's
      // URL field — row 0, the same landing spot SET_MODE uses — so the user
      // pastes the next link instead of pressing Enter on the just-finished
      // Download button again. Starting a download leaves taskIndex alone.
      return {
        ...state,
        downloadActive: action.active,
        taskIndex: action.active ? state.taskIndex : 0,
      };
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
