// The signed-request layer that ties the native signers (X-Bogus / a_bogus /
// msToken) to douyin's web API. Tracked in vendor-api/tally.json.
//
// Scope: the request core + the endpoint methods the engine consumes. The
// Playwright browser fallback (collect_user_post_ids_via_browser) stays on the
// sidecar break-glass. Uses global fetch; proxy via an undici ProxyAgent.

import { ProxyAgent } from "undici";
import { losslessJsonParse } from "./lossless-json.js";
import { buildXBogus } from "./signing/xbogus.js";
import { buildABogus, generateFingerprint } from "./signing/abogus.js";
import { MsTokenManager } from "./signing/mstoken.js";

const BASE_URL = "https://www.douyin.com";
const USER_AGENT_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
];

export interface PagedResponse {
  items: Record<string, unknown>[];
  aweme_list: Record<string, unknown>[];
  has_more: boolean;
  max_cursor: number;
  status_code: number;
  source: string;
  risk_flags: { login_tip: boolean; verify_page: boolean };
  raw: Record<string, unknown>;
  [extra: string]: unknown;
}

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Dict) : {});

function pyInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^[+-]?\d+$/.test(v.trim())) return Number(v.trim());
  return 0;
}

export class NativeDouyinApiClient {
  private cookies: Record<string, string>;
  private readonly proxy: string;
  private readonly headers: Record<string, string>;
  private readonly userAgent: string;
  private msToken: string;
  private readonly msTokenManager: MsTokenManager;
  private readonly dispatcher?: ProxyAgent;

  constructor(cookies: Record<string, string>, proxy = "") {
    this.cookies = { ...(cookies ?? {}) };
    this.proxy = (proxy ?? "").trim();
    this.userAgent = USER_AGENT_POOL[Math.floor(Math.random() * USER_AGENT_POOL.length)]!;
    this.headers = {
      "User-Agent": this.userAgent,
      Referer: "https://www.douyin.com/",
      Accept: "application/json",
      "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    };
    this.msToken = (this.cookies["msToken"] ?? "").trim();
    this.msTokenManager = new MsTokenManager(this.userAgent);
    this.dispatcher = this.proxy ? new ProxyAgent(this.proxy) : undefined;
  }

  private cookieHeader(): string {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private async ensureMsToken(): Promise<string> {
    if (this.msToken) return this.msToken;
    const token = (await this.msTokenManager.ensureMsToken(this.cookies)).trim();
    this.msToken = token;
    if (token) this.cookies["msToken"] = token;
    return token;
  }

  private async defaultQuery(): Promise<Record<string, string>> {
    const msToken = await this.ensureMsToken();
    return {
      device_platform: "webapp", aid: "6383", channel: "channel_pc_web",
      update_version_code: "170400", pc_client_type: "1", version_code: "290100",
      version_name: "29.1.0", cookie_enabled: "true", screen_width: "1920",
      screen_height: "1080", browser_language: "zh-CN", browser_platform: "Win32",
      browser_name: "Chrome", browser_version: "130.0.0.0", browser_online: "true",
      engine_name: "Blink", engine_version: "130.0.0.0", os_name: "Windows",
      os_version: "10", cpu_core_num: "12", device_memory: "8", platform: "PC",
      downlink: "10", effective_type: "4g", round_trip_time: "100", msToken,
    };
  }

  signUrl(url: string): { url: string; userAgent: string } {
    const r = buildXBogus(url, { userAgent: this.userAgent });
    return { url: r.signedUrl, userAgent: r.userAgent };
  }

  // build_signed_path: try a_bogus, fall back to X-Bogus.
  buildSignedPath(path: string, params: Record<string, unknown>): { url: string; userAgent: string } {
    const query = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    const baseUrl = `${BASE_URL}${path}`;
    try {
      const ab = buildABogus(query, "", {
        userAgent: this.userAgent,
        fp: generateFingerprint("Win32"),
      });
      return { url: `${baseUrl}?${ab.signedParams}`, userAgent: ab.userAgent };
    } catch {
      return this.signUrl(`${baseUrl}?${query}`);
    }
  }

  private async requestJson(
    path: string,
    params: Record<string, unknown>,
    opts: { suppressError?: boolean; maxRetries?: number } = {},
  ): Promise<Dict> {
    const maxRetries = opts.maxRetries ?? 3;
    const delays = [1000, 2000, 5000];
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const { url, userAgent } = this.buildSignedPath(path, params);
      try {
        const resp = await fetch(url, {
          method: "GET",
          headers: { ...this.headers, "User-Agent": userAgent, Cookie: this.cookieHeader() },
          ...(this.dispatcher ? ({ dispatcher: this.dispatcher } as Record<string, unknown>) : {}),
        });
        if (resp.status === 200) {
          // Lossless parse: keep 19-digit ids exact (JSON.parse would truncate
          // bare numeric ids >=2^53 -> wrong dedup key + filename).
          let data: unknown = {};
          try {
            data = losslessJsonParse(await resp.text());
          } catch {
            data = {}; // malformed body -> empty
          }
          return asDict(data);
        }
        if (resp.status < 500 && resp.status !== 429) return {};
      } catch {
        /* network error -> retry */
      }
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delays[Math.min(attempt, delays.length - 1)]));
      }
    }
    return {};
  }

  private normalizePaged(rawData: unknown, itemKeys: string[] = [], source = "api"): PagedResponse {
    const raw = asDict(rawData);
    const keys = ["items", ...itemKeys, "aweme_list", "mix_list", "music_list"];
    let items: Dict[] = [];
    for (const key of keys) {
      const value = raw[key];
      if (Array.isArray(value)) {
        items = value as Dict[];
        break;
      }
    }
    const hasMoreRaw = raw["has_more"] ?? false;
    const hasMore = typeof hasMoreRaw === "number" ? hasMoreRaw !== 0 : Boolean(hasMoreRaw);
    const maxCursor = pyInt(raw["max_cursor"] ?? raw["cursor"] ?? 0);
    const notLogin = asDict(raw["not_login_module"]);
    const normalized: PagedResponse = {
      items,
      aweme_list: items,
      has_more: hasMore,
      max_cursor: maxCursor,
      status_code: pyInt(raw["status_code"] ?? 0),
      source,
      risk_flags: {
        login_tip: Boolean(notLogin["guide_login_tip_exist"]),
        verify_page: Boolean(raw["verify_ticket"]),
      },
      raw,
    };
    for (const [k, v] of Object.entries(raw)) if (!(k in normalized)) normalized[k] = v;
    return normalized;
  }

  private async userPageParams(secUid: string, maxCursor: number, count: number): Promise<Record<string, unknown>> {
    return { ...(await this.defaultQuery()), sec_user_id: secUid, max_cursor: maxCursor, count, locate_query: "false" };
  }

  private async collectPageParams(maxCursor: number, count: number): Promise<Record<string, unknown>> {
    return { ...(await this.defaultQuery()), cursor: maxCursor, count, version_code: "170400", version_name: "17.4.0" };
  }

  // aid=6383 works for notes/gallery; aid=1128 for some video content.
  private static readonly DETAIL_AIDS = ["6383", "1128"];

  async getVideoDetail(awemeId: string, opts: { suppressError?: boolean } = {}): Promise<Dict | null> {
    for (let i = 0; i < NativeDouyinApiClient.DETAIL_AIDS.length; i++) {
      const aid = NativeDouyinApiClient.DETAIL_AIDS[i]!;
      const params = { ...(await this.defaultQuery()), aweme_id: awemeId, aid };
      const data = await this.requestJson("/aweme/v1/web/aweme/detail/", params, {
        suppressError: opts.suppressError || i !== NativeDouyinApiClient.DETAIL_AIDS.length - 1,
      });
      if (!data || Object.keys(data).length === 0) continue;
      const detail = data["aweme_detail"];
      if (detail) return asDict(detail);
      const filterInfo = asDict(data["filter_detail"]);
      if (filterInfo["filter_reason"]) continue;
      break;
    }
    return null;
  }

  async getUserPost(secUid: string, maxCursor = 0, count = 20): Promise<PagedResponse> {
    const params = {
      ...(await this.userPageParams(secUid, maxCursor, count)),
      show_live_replay_strategy: "1", need_time_list: "1", time_list_query: "0",
      whale_cut_token: "", cut_version: "1", publish_video_strategy_type: "2",
    };
    return this.normalizePaged(await this.requestJson("/aweme/v1/web/aweme/post/", params), ["aweme_list"]);
  }

  async getUserLike(secUid: string, maxCursor = 0, count = 20): Promise<PagedResponse> {
    const params = await this.userPageParams(secUid, maxCursor, count);
    return this.normalizePaged(await this.requestJson("/aweme/v1/web/aweme/favorite/", params), ["aweme_list"]);
  }

  async getUserCollects(secUid: string, maxCursor = 0, count = 10): Promise<PagedResponse> {
    if (secUid && secUid !== "self") return this.normalizePaged({}, ["collects_list"]);
    const params = await this.collectPageParams(maxCursor, count);
    return this.normalizePaged(await this.requestJson("/aweme/v1/web/collects/list/", params), ["collects_list"]);
  }

  async getCollectAweme(collectsId: string, maxCursor = 0, count = 10): Promise<PagedResponse> {
    const params = { ...(await this.collectPageParams(maxCursor, count)), collects_id: collectsId };
    return this.normalizePaged(await this.requestJson("/aweme/v1/web/collects/video/list/", params), ["aweme_list"]);
  }

  async getUserInfo(secUid: string): Promise<Dict | null> {
    const params = { ...(await this.defaultQuery()), sec_user_id: secUid };
    const data = await this.requestJson("/aweme/v1/web/user/profile/other/", params);
    return data["user"] ? asDict(data["user"]) : null;
  }

  async getMixDetail(mixId: string): Promise<Dict | null> {
    const params = { ...(await this.defaultQuery()), mix_id: mixId };
    const data = await this.requestJson("/aweme/v1/web/mix/detail/", params);
    if (!data || Object.keys(data).length === 0) return null;
    return asDict(data["mix_info"] ?? data["mix_detail"] ?? data);
  }

  async getMixAweme(mixId: string, cursor = 0, count = 20): Promise<PagedResponse> {
    const params = { ...(await this.defaultQuery()), mix_id: mixId, cursor, count };
    return this.normalizePaged(await this.requestJson("/aweme/v1/web/mix/aweme/", params), ["aweme_list"]);
  }

  async getMusicDetail(musicId: string): Promise<Dict | null> {
    const params = { ...(await this.defaultQuery()), music_id: musicId };
    const data = await this.requestJson("/aweme/v1/web/music/detail/", params);
    if (!data || Object.keys(data).length === 0) return null;
    return asDict(data["music_info"] ?? data["music_detail"] ?? data);
  }

  // Follow the short-link 302 chain; null on HTTP >= 400 or failure.
  async resolveShortUrl(shortUrl: string, timeoutSeconds = 10): Promise<string | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutSeconds * 1000);
    try {
      const resp = await fetch(shortUrl, {
        method: "GET",
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "User-Agent": this.userAgent },
        ...(this.dispatcher ? ({ dispatcher: this.dispatcher } as Record<string, unknown>) : {}),
      });
      if (resp.status >= 400) return null;
      return resp.url;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
