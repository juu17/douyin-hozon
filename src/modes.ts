import { defaultSavePath } from "./engine/file-layout.js";
import { normalizeDouyinUrl } from "./engine/url-utils.js";

export type ModeId =
  | "single-video"
  | "image-note"
  | "collection"
  | "music-track"
  | "creator-liked-posts"
  | "my-favorite-collection";

export type FieldKind = "text" | "number" | "boolean" | "readonly";
export type FieldPlacement = "task" | "settings";

export type ValueMap = Record<string, string | boolean>;

// Platform-aware download root: ~/Downloads/douyin-hozon/ on macOS/Linux,
// %USERPROFILE%\Downloads\douyin-hozon\ on Windows.
const SAVE_PATH_DEFAULT = defaultSavePath();

// Each mode owns its own URL store key so switching modes doesn't bleed a
// previously-typed URL into a different mode's input. The keys map 1:1 to
// FieldDefinition.id below.
export const URL_FIELD_BY_MODE: Record<ModeId, string> = {
  "single-video": "videoUrl",
  "image-note": "noteUrl",
  "collection": "collectionUrl",
  "music-track": "musicUrl",
  "creator-liked-posts": "creatorUrl",
  "my-favorite-collection": "favoriteSource",
};

export function urlFieldForMode(modeId: ModeId): string {
  return URL_FIELD_BY_MODE[modeId];
}

export interface FieldDefinition {
  id: string;
  label: string;
  kind: FieldKind;
  placement?: FieldPlacement;
  placeholder?: string;
  helper?: string;
  visible?: (values: ValueMap) => boolean;
  // Synchronous post-commit transform. Runs when the user commits the
  // field (Enter); the cleaned value goes into the store. URL fields use
  // this to strip share-text noise around the URL.
  transform?: (raw: string) => string;
  // Marks fields whose committed value can be a short URL that should be
  // followed via HTTP redirect by use-url-resolver.ts.
  resolvable?: boolean;
}

export interface ModeDefinition {
  id: ModeId;
  title: string;
  description: string;
  fields: FieldDefinition[];
}

const commonSettingsFields: FieldDefinition[] = [
  { id: "thread", label: "Concurrent Downloads", kind: "number", placement: "settings", placeholder: "5" },
  { id: "retryTimes", label: "Retry Times", kind: "number", placement: "settings", placeholder: "3" },
  { id: "quietLogs", label: "Quiet Logs", kind: "boolean", placement: "settings" },
  {
    id: "proxy",
    label: "Proxy",
    kind: "text",
    placement: "settings",
    placeholder: "http://127.0.0.1:7890",
  },
  { id: "msToken", label: "msToken", kind: "text", placement: "settings" },
  { id: "ttwid", label: "ttwid", kind: "text", placement: "settings" },
  { id: "odin_tt", label: "odin_tt", kind: "text", placement: "settings" },
  { id: "passportCsrfToken", label: "passport_csrf_token", kind: "text", placement: "settings" },
  { id: "sidGuard", label: "sid_guard", kind: "text", placement: "settings" },
];

const mediaTaskFields: FieldDefinition[] = [
  { id: "includeCover", label: "Download Cover", kind: "boolean", placement: "task" },
  { id: "includeMusic", label: "Download Music", kind: "boolean", placement: "task" },
  { id: "includeAvatar", label: "Download Avatar", kind: "boolean", placement: "task" },
  { id: "includeJson", label: "Save Metadata JSON", kind: "boolean", placement: "task" },
];

const mediaTaskFieldsNoMusic: FieldDefinition[] = [
  { id: "includeCover", label: "Download Cover", kind: "boolean", placement: "task" },
  { id: "includeAvatar", label: "Download Avatar", kind: "boolean", placement: "task" },
  { id: "includeJson", label: "Save Metadata JSON", kind: "boolean", placement: "task" },
];

export const MODE_DEFINITIONS: ModeDefinition[] = [
  {
    id: "single-video",
    title: "Single Video",
    description: "Download one Douyin video from a video URL or short link.",
    fields: [
      {
        id: "videoUrl",
        label: "Video URL",
        kind: "text",
        placement: "task",
        placeholder: "https://www.douyin.com/video/...",
        transform: normalizeDouyinUrl,
        resolvable: true,
      },
      { id: "savePath", label: "Save Path", kind: "text", placement: "task", placeholder: SAVE_PATH_DEFAULT },
      ...mediaTaskFields,
      ...commonSettingsFields,
    ],
  },
  {
    id: "image-note",
    title: "Image Note",
    description: "Download one image note from a note or gallery URL.",
    fields: [
      {
        id: "noteUrl",
        label: "Note URL",
        kind: "text",
        placement: "task",
        placeholder: "https://www.douyin.com/note/...",
        transform: normalizeDouyinUrl,
        resolvable: true,
      },
      { id: "savePath", label: "Save Path", kind: "text", placement: "task", placeholder: SAVE_PATH_DEFAULT },
      ...mediaTaskFields,
      ...commonSettingsFields,
    ],
  },
  {
    id: "collection",
    title: "Collection",
    description: "Download a collection or mix with optional limits and date filters.",
    fields: [
      {
        id: "collectionUrl",
        label: "Collection URL",
        kind: "text",
        placement: "task",
        placeholder: "https://www.douyin.com/collection/...",
        transform: normalizeDouyinUrl,
        resolvable: true,
      },
      { id: "savePath", label: "Save Path", kind: "text", placement: "task", placeholder: SAVE_PATH_DEFAULT },
      { id: "limit", label: "Item Limit", kind: "number", placement: "task", placeholder: "0" },
      { id: "startTime", label: "Start Date", kind: "text", placement: "task", placeholder: "YYYY-MM-DD" },
      { id: "endTime", label: "End Date", kind: "text", placement: "task", placeholder: "YYYY-MM-DD" },
      ...mediaTaskFields,
      ...commonSettingsFields,
    ],
  },
  {
    id: "music-track",
    title: "Music Track",
    description: "Download one music track from a music URL.",
    fields: [
      {
        id: "musicUrl",
        label: "Music URL",
        kind: "text",
        placement: "task",
        placeholder: "https://www.douyin.com/music/...",
        transform: normalizeDouyinUrl,
        resolvable: true,
      },
      { id: "savePath", label: "Save Path", kind: "text", placement: "task", placeholder: SAVE_PATH_DEFAULT },
      ...mediaTaskFieldsNoMusic,
      ...commonSettingsFields,
    ],
  },
  {
    id: "creator-liked-posts",
    title: "Creator Liked Posts",
    description: "Batch download a creator's liked posts with limits and date filters.",
    fields: [
      {
        id: "creatorUrl",
        label: "Creator URL",
        kind: "text",
        placement: "task",
        placeholder: "https://www.douyin.com/user/...",
        transform: normalizeDouyinUrl,
        resolvable: true,
      },
      { id: "savePath", label: "Save Path", kind: "text", placement: "task", placeholder: SAVE_PATH_DEFAULT },
      { id: "limit", label: "Item Limit", kind: "number", placement: "task", placeholder: "0" },
      { id: "startTime", label: "Start Date", kind: "text", placement: "task", placeholder: "YYYY-MM-DD" },
      { id: "endTime", label: "End Date", kind: "text", placement: "task", placeholder: "YYYY-MM-DD" },
      ...mediaTaskFields,
      ...commonSettingsFields,
    ],
  },
  {
    id: "my-favorite-collection",
    title: "My Favorite Collection",
    description: "Download the logged-in account's favorite collection items.",
    fields: [
      {
        id: "favoriteSource",
        label: "Favorite Source",
        kind: "readonly",
        placement: "task",
      },
      { id: "savePath", label: "Save Path", kind: "text", placement: "task", placeholder: SAVE_PATH_DEFAULT },
      { id: "limit", label: "Item Limit", kind: "number", placement: "task", placeholder: "0" },
      ...mediaTaskFields,
      ...commonSettingsFields,
    ],
  },
];

export const MODE_INDEX = new Map(MODE_DEFINITIONS.map((mode) => [mode.id, mode]));

export function getMode(modeId: ModeId): ModeDefinition {
  const mode = MODE_INDEX.get(modeId);
  if (!mode) {
    throw new Error(`Unknown mode: ${modeId}`);
  }
  return mode;
}

export function getVisibleFields(modeId: ModeId, values: ValueMap): FieldDefinition[] {
  return getMode(modeId).fields.filter((field) => !field.visible || field.visible(values));
}

export function getTaskFields(modeId: ModeId, values: ValueMap): FieldDefinition[] {
  return getVisibleFields(modeId, values).filter((field) => (field.placement ?? "task") === "task");
}

export function getSettingsFields(modeId: ModeId, values: ValueMap): FieldDefinition[] {
  return getVisibleFields(modeId, values).filter((field) => field.placement === "settings");
}

export const DEFAULT_VALUES: ValueMap = {
  videoUrl: "",
  noteUrl: "",
  collectionUrl: "",
  musicUrl: "",
  creatorUrl: "",
  savePath: SAVE_PATH_DEFAULT,
  favoriteSource: "https://www.douyin.com/user/self?showTab=favorite_collection",
  limit: "0",
  startTime: "",
  endTime: "",
  includeCover: true,
  includeMusic: true,
  includeAvatar: true,
  includeJson: true,
  thread: "5",
  retryTimes: "3",
  quietLogs: true,
  proxy: "",
  msToken: "",
  ttwid: "",
  odin_tt: "",
  passportCsrfToken: "",
  sidGuard: "",
};

export function createInitialValues(): ValueMap {
  return { ...DEFAULT_VALUES };
}

// Each mode REMEMBERS these fields independently — its URL field plus its
// batch/filter fields. Changing `limit` in Collection doesn't affect Creator
// Liked Posts; switching back restores Collection's own remembered value.
export const PER_MODE_FIELD_IDS = new Set<string>([
  "videoUrl", "noteUrl", "collectionUrl", "musicUrl", "creatorUrl",
  "favoriteSource", "limit", "startTime", "endTime",
]);

export function isPerModeField(id: string): boolean {
  return PER_MODE_FIELD_IDS.has(id);
}

// Initial per-mode field values keyed by mode. Each mode's bucket starts at the
// defaults relevant to that mode; absent keys fall through to DEFAULT_VALUES.
export const PER_MODE_DEFAULTS: Record<ModeId, Partial<ValueMap>> = {
  "single-video": { videoUrl: "" },
  "image-note": { noteUrl: "" },
  "collection": { collectionUrl: "", limit: "0", startTime: "", endTime: "" },
  "music-track": { musicUrl: "" },
  "creator-liked-posts": { creatorUrl: "", limit: "0", startTime: "", endTime: "" },
  "my-favorite-collection": {
    favoriteSource: "https://www.douyin.com/user/self?showTab=favorite_collection",
    limit: "0",
  },
};

// Everything not in PER_MODE_FIELD_IDS is shared across all modes (savePath,
// the include* toggles, thread, retryTimes, quietLogs, proxy, msToken/...).
export const SHARED_DEFAULTS: Partial<ValueMap> = (() => {
  const out: Partial<ValueMap> = {};
  for (const [k, v] of Object.entries(DEFAULT_VALUES)) {
    if (!PER_MODE_FIELD_IDS.has(k)) (out as Record<string, unknown>)[k] = v;
  }
  return out;
})();
