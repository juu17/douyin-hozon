// Wire-protocol types between the Node parser client and parser_sidecar.py.
// These mirror the JSON-line protocol described at the top of parser_sidecar.py.

export type SidecarReady = {
  type: "ready";
  version: string;
  downloader_root: string;
};

export type SidecarEvent = {
  event: string;
  level?: "info" | "warn" | "error";
  message?: string;
  [extra: string]: unknown;
};

export interface SidecarRequest<P = unknown> {
  id: number;
  method: string;
  params: P;
}

export interface SidecarOk<R = unknown> {
  id: number;
  result: R;
}

export interface SidecarErrPayload {
  code: string;
  message: string;
  trace?: string;
}

export interface SidecarErr {
  id: number;
  error: SidecarErrPayload;
}

export type SidecarResponse<R = unknown> = SidecarOk<R> | SidecarErr;

// Method param/result shapes (only the ones the engine consumes; expand as
// new modes wire through).

export interface InitParams {
  cookies: Record<string, string>;
  proxy?: string;
}

export interface InitResult {
  ok: boolean;
  downloader_root: string;
}

// "short" is emitted by the parser when the input is still an unresolved
// short link (v.douyin.com/...). In practice the engine resolves short URLs
// before parsing, so downstream rarely sees it — but the native port mirrors
// upstream's parse_url_type exactly, which can return it.
export type ParsedUrlKind =
  | "video"
  | "user"
  | "collection"
  | "gallery"
  | "music"
  | "live"
  | "short";

export interface ParsedUrl {
  original_url: string;
  type: ParsedUrlKind;
  aweme_id?: string;
  sec_uid?: string;
  mix_id?: string;
  note_id?: string;
  music_id?: string;
  room_id?: string;
}

// DouyinAPIClient returns weakly-typed dicts. The engine treats them as
// opaque records and reads only the fields it needs at the call site.
export type AwemeDetail = Record<string, unknown>;
export type UserInfo = Record<string, unknown>;
export type MixDetail = Record<string, unknown>;
export type MusicDetail = Record<string, unknown>;

export interface PagedResponse<T = Record<string, unknown>> {
  items: T[];
  has_more: boolean;
  max_cursor: number;
  source?: "api" | "browser";
  [extra: string]: unknown;
}

export interface AssetSpec {
  url: string;
  headers: Record<string, string>;
}

export interface AwemeAssetBundle {
  media_type: "video" | "gallery";
  aweme_id: string;
  title: string;
  publish_ts: number | null;
  publish_date: string;
  file_stem: string;
  author: {
    id: string | null;
    name: string;
    avatar: AssetSpec | null;
  };
  video: AssetSpec | null;
  cover: AssetSpec | null;
  music: AssetSpec | null;
  images: AssetSpec[];
  image_live: AssetSpec[];
  raw: Record<string, unknown>;
}

export interface MusicAssetBundle {
  music_id: string;
  title: string;
  author: string;
  file_stem: string;
  audio: AssetSpec | null;
  cover: AssetSpec | null;
  raw: Record<string, unknown>;
}

// Sidecar config — used only by the spawn helper.
export interface SidecarSpawnConfig {
  pythonBin: string;          // absolute path to the venv's python
  sidecarScript: string;      // absolute path to parser_sidecar.py
  cwd: string;                // working dir for the python process
  env?: NodeJS.ProcessEnv;    // env merged on top of process.env
  readyTimeoutMs?: number;    // default 10000
}
