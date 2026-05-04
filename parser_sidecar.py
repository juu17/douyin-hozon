#!/usr/bin/env python3
"""JSON-line stdio sidecar wrapping douyin-downloader/core/api_client.py.

The TUI (Node) spawns this once at startup, sends an `init` request to
configure cookies and proxy, then issues parse-only method calls. All other
concerns (download, file IO, DB, progress) live in the Node engine.

Protocol — one JSON object per line, both directions:

    Server announce (once at startup):
      {"type": "ready", "version": "1.0", "downloader_root": "..."}

    Client request:
      {"id": <int>, "method": "<name>", "params": {...}}

    Server response:
      {"id": <int>, "result": <any>}
      {"id": <int>, "error": {"code": "...", "message": "...", "trace": "..."}}

    Server event (unsolicited, no id):
      {"event": "log", "level": "warn", "message": "..."}

Methods: init, shutdown, parse_url, plus thin pass-throughs to
DouyinAPIClient. We intentionally add no logic — upstream owns all signing,
msToken handling, retries, response unmarshalling, browser fallback.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import traceback
from typing import Any, Awaitable, Callable, Dict, Optional


def _bootstrap_sys_path() -> str:
    env_path = os.environ.get("DOUYIN_HOZON_DOWNLOADER_PATH")
    if env_path:
        path = os.path.abspath(env_path)
    else:
        here = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(here, "douyin-downloader")
    if not os.path.isdir(path):
        raise RuntimeError(f"douyin-downloader not found at {path}")
    sys.path.insert(0, path)
    return path


_DOWNLOADER_ROOT = _bootstrap_sys_path()


def _load_module(name: str, relpath: str):
    """Load a module file directly, bypassing its package __init__.

    Why: upstream's `core/__init__.py` re-exports `DownloaderFactory`, which
    pulls in storage/transcript/etc. and transitively requires aiosqlite,
    rich, and friends. The parser sidecar needs none of that. Loading
    `core/api_client.py` and `core/url_parser.py` as standalone modules keeps
    the dependency surface to just what api_client itself imports
    (aiohttp, gmssl, pyyaml, aiofiles).
    """
    import importlib.util

    abs_path = os.path.join(_DOWNLOADER_ROOT, relpath)
    spec = importlib.util.spec_from_file_location(name, abs_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {name} from {abs_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_api_client_mod = _load_module("core_api_client", "core/api_client.py")
_url_parser_mod = _load_module("core_url_parser", "core/url_parser.py")
_validators_mod = _load_module("utils_validators", "utils/validators.py")
DouyinAPIClient = _api_client_mod.DouyinAPIClient
URLParser = _url_parser_mod.URLParser
sanitize_filename = _validators_mod.sanitize_filename


# ---------------------------------------------------------------------------
# Aweme asset extraction
#
# Mirrors the URL-selection logic inside upstream's
# core/downloader_base.py:BaseDownloader (_build_no_watermark_url,
# _collect_image_urls, _collect_image_live_urls, _pick_highest_quality_play_addr,
# etc.). Lifted here so all decisions about douyin's JSON shape live next to
# the API client — when upstream updates either, we git-pull and the sidecar
# follows. The Node engine receives ready-to-fetch (url, headers) pairs and
# does the actual HTTP downloads + file IO.
# ---------------------------------------------------------------------------

from datetime import datetime as _dt  # noqa: E402
from typing import List as _List, Tuple as _Tuple  # noqa: E402
from urllib.parse import urlparse as _urlparse  # noqa: E402


def _resolve_publish(create_time: Any) -> _Tuple[Optional[int], str]:
    if create_time in (None, ""):
        return None, ""
    try:
        ts = int(create_time)
        if ts <= 0:
            return None, ""
        return ts, _dt.fromtimestamp(ts).strftime("%Y-%m-%d")
    except Exception:
        return None, ""


def _pick_highest_quality_play_addr(video: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    bit_rates = video.get("bit_rate") if isinstance(video, dict) else None
    if not isinstance(bit_rates, list) or not bit_rates:
        return None
    best = None
    best_score = -1
    for entry in bit_rates:
        if not isinstance(entry, dict):
            continue
        play_addr = entry.get("play_addr")
        if not isinstance(play_addr, dict):
            continue
        try:
            br = int(entry.get("bit_rate") or 0)
        except (TypeError, ValueError):
            br = 0
        width = int(play_addr.get("width") or entry.get("width") or 0)
        score = br * 10_000 + width
        if score > best_score:
            best_score = score
            best = play_addr
    return best


def _extract_first_url(source: Any) -> Optional[str]:
    if isinstance(source, dict):
        url_list = source.get("url_list")
        if isinstance(url_list, list) and url_list:
            first = url_list[0]
            if isinstance(first, str) and first:
                return first
    elif isinstance(source, list) and source:
        first = source[0]
        if isinstance(first, str) and first:
            return first
    elif isinstance(source, str) and source:
        return source
    return None


def _pick_first_media_url(*sources: Any) -> Optional[str]:
    for s in sources:
        u = _extract_first_url(s)
        if u:
            return u
    return None


def _iter_gallery_items(aweme_data: Dict[str, Any]) -> _List[Any]:
    image_post = aweme_data.get("image_post_info")
    if isinstance(image_post, dict):
        for key in ("images", "image_list"):
            cand = image_post.get(key)
            if isinstance(cand, list) and cand:
                return cand
    images = aweme_data.get("images") or aweme_data.get("image_list") or []
    return images if isinstance(images, list) else []


_GALLERY_AWEME_TYPES = {2, 68, 150}


def _detect_media_type(aweme_data: Dict[str, Any]) -> str:
    if (
        aweme_data.get("image_post_info")
        or aweme_data.get("images")
        or aweme_data.get("image_list")
    ):
        return "gallery"
    at = aweme_data.get("aweme_type")
    if isinstance(at, int) and at in _GALLERY_AWEME_TYPES:
        return "gallery"
    return "video"


def _download_headers(api_client: Any, user_agent: Optional[str] = None) -> Dict[str, str]:
    base = api_client.BASE_URL
    return {
        "Referer": f"{base}/",
        "Origin": base,
        "Accept": "*/*",
        "User-Agent": user_agent or api_client.headers.get("User-Agent", ""),
    }


def _select_video_asset(
    api_client: Any, aweme_data: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    video = aweme_data.get("video", {}) or {}
    play_addr = _pick_highest_quality_play_addr(video) or video.get("play_addr", {}) or {}
    candidates = [c for c in (play_addr.get("url_list") or []) if c]
    candidates.sort(key=lambda u: 0 if "watermark=0" in u else 1)
    fallback: Optional[Dict[str, Any]] = None
    for c in candidates:
        parsed = _urlparse(c)
        headers = _download_headers(api_client)
        if parsed.netloc.endswith("douyin.com"):
            if "X-Bogus=" not in c:
                signed_url, ua = api_client.sign_url(c)
                return {"url": signed_url, "headers": _download_headers(api_client, ua)}
            return {"url": c, "headers": headers}
        fallback = {"url": c, "headers": headers}
    if fallback:
        return fallback
    uri = (
        play_addr.get("uri")
        or video.get("vid")
        or (video.get("download_addr", {}) or {}).get("uri")
    )
    if uri:
        params = {
            "video_id": uri,
            "ratio": "1080p",
            "line": "0",
            "is_play_url": "1",
            "watermark": "0",
            "source": "PackSourceEnum_PUBLISH",
        }
        signed_url, ua = api_client.build_signed_path("/aweme/v1/play/", params)
        return {"url": signed_url, "headers": _download_headers(api_client, ua)}
    return None


def _select_image_assets(
    api_client: Any, aweme_data: Dict[str, Any]
) -> _List[Dict[str, Any]]:
    headers = _download_headers(api_client)
    out: _List[Dict[str, Any]] = []
    seen: set = set()
    for item in _iter_gallery_items(aweme_data):
        if not isinstance(item, dict):
            continue
        url = _pick_first_media_url(
            item.get("download_url"),
            item.get("download_addr"),
            item.get("download_url_list"),
            item,
            item.get("display_image"),
            item.get("owner_watermark_image"),
        )
        if url and url not in seen:
            seen.add(url)
            out.append({"url": url, "headers": headers})
    return out


def _select_image_live_assets(
    api_client: Any, aweme_data: Dict[str, Any]
) -> _List[Dict[str, Any]]:
    headers = _download_headers(api_client)
    out: _List[Dict[str, Any]] = []
    seen: set = set()
    for item in _iter_gallery_items(aweme_data):
        if not isinstance(item, dict):
            continue
        video = item.get("video") if isinstance(item.get("video"), dict) else {}
        preferred = _pick_highest_quality_play_addr(video) if video else None
        url = _pick_first_media_url(
            preferred,
            video.get("play_addr") if video else None,
            video.get("download_addr") if video else None,
            item.get("video_play_addr"),
            item.get("video_download_addr"),
        )
        if url and url not in seen:
            seen.add(url)
            out.append({"url": url, "headers": headers})
    return out


def extract_aweme_assets(api_client: Any, aweme_data: Dict[str, Any]) -> Dict[str, Any]:
    """Lift ready-to-fetch (url, headers) pairs out of an aweme_detail dict.

    Returned shape (None for absent assets):
      {
        "media_type": "video" | "gallery",
        "aweme_id": str,
        "title": str,
        "publish_ts": int | None,
        "publish_date": str,                # YYYY-MM-DD or ""
        "file_stem": str,                   # sanitized "<date>_<title>_<id>"
        "author": {"id": str|None, "name": str, "avatar": {url, headers} | None},
        "video": {url, headers} | None,
        "cover": {url, headers} | None,
        "music": {url, headers} | None,
        "images": [{url, headers}, ...],
        "image_live": [{url, headers}, ...],
        "raw": <aweme_data>,                # for JSON metadata save
      }
    """
    aweme_id = str(aweme_data.get("aweme_id") or "")
    title = (aweme_data.get("desc") or "no_title").strip() or "no_title"
    publish_ts, publish_date = _resolve_publish(aweme_data.get("create_time"))
    if not publish_date:
        publish_date = _dt.now().strftime("%Y-%m-%d")
    file_stem = sanitize_filename(f"{publish_date}_{title}_{aweme_id}")
    media_type = _detect_media_type(aweme_data)
    headers = _download_headers(api_client)

    author = aweme_data.get("author", {}) or {}
    avatar_url = _extract_first_url(author.get("avatar_larger"))
    author_payload = {
        "id": author.get("uid"),
        "name": author.get("nickname") or "unknown_author",
        "avatar": {"url": avatar_url, "headers": headers} if avatar_url else None,
    }

    video_asset = None
    cover_asset = None
    music_asset = None
    images: _List[Dict[str, Any]] = []
    image_live: _List[Dict[str, Any]] = []

    if media_type == "video":
        video_asset = _select_video_asset(api_client, aweme_data)
        cover_url = _extract_first_url((aweme_data.get("video") or {}).get("cover"))
        if cover_url:
            cover_asset = {"url": cover_url, "headers": headers}
        music_url = _extract_first_url((aweme_data.get("music") or {}).get("play_url"))
        if music_url:
            music_asset = {"url": music_url, "headers": headers}
    else:
        images = _select_image_assets(api_client, aweme_data)
        image_live = _select_image_live_assets(api_client, aweme_data)

    return {
        "media_type": media_type,
        "aweme_id": aweme_id,
        "title": title,
        "publish_ts": publish_ts,
        "publish_date": publish_date,
        "file_stem": file_stem,
        "author": author_payload,
        "video": video_asset,
        "cover": cover_asset,
        "music": music_asset,
        "images": images,
        "image_live": image_live,
        "raw": aweme_data,
    }


def extract_music_assets(api_client: Any, music_detail: Dict[str, Any]) -> Dict[str, Any]:
    """Extract audio + cover URLs from a /aweme/v1/web/music/detail/ response.

    Result shape:
      {
        "music_id": str,
        "title": str,
        "author": str,
        "file_stem": str,
        "audio": {url, headers} | None,
        "cover": {url, headers} | None,
        "raw": <music_detail>,
      }
    """
    music_id = str(music_detail.get("id") or music_detail.get("id_str") or "")
    title = (music_detail.get("title") or "no_title").strip() or "no_title"
    author = (music_detail.get("author") or "unknown").strip() or "unknown"
    file_stem = sanitize_filename(f"{author}_{title}_{music_id}")
    headers = _download_headers(api_client)
    audio_url = _extract_first_url(music_detail.get("play_url"))
    cover_url = _extract_first_url(
        music_detail.get("cover_large")
        or music_detail.get("cover_medium")
        or music_detail.get("cover_thumb")
    )
    return {
        "music_id": music_id,
        "title": title,
        "author": author,
        "file_stem": file_stem,
        "audio": {"url": audio_url, "headers": headers} if audio_url else None,
        "cover": {"url": cover_url, "headers": headers} if cover_url else None,
        "raw": music_detail,
    }


async def _async_return(value: Any) -> Any:
    """Wrap a sync value as an awaitable so the dispatch table is uniform."""
    return value


class Sidecar:
    def __init__(self) -> None:
        self._client: Optional[DouyinAPIClient] = None
        self._stdout_lock = asyncio.Lock()

    async def _send(self, payload: Dict[str, Any]) -> None:
        line = json.dumps(payload, ensure_ascii=False, default=str)
        async with self._stdout_lock:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()

    async def _emit_event(self, kind: str, **fields: Any) -> None:
        await self._send({"event": kind, **fields})

    async def _init(self, params: Dict[str, Any]) -> Dict[str, Any]:
        if self._client is not None:
            await self._client.close()
        cookies = params.get("cookies") or {}
        proxy = params.get("proxy") or ""
        self._client = DouyinAPIClient(cookies=cookies, proxy=proxy)
        await self._client.__aenter__()
        return {"ok": True, "downloader_root": _DOWNLOADER_ROOT}

    async def _shutdown(self) -> Dict[str, Any]:
        if self._client is not None:
            await self._client.__aexit__(None, None, None)
            self._client = None
        return {"ok": True}

    def _api_dispatch_table(
        self, client: DouyinAPIClient, params: Dict[str, Any]
    ) -> Dict[str, Callable[[], Awaitable[Any]]]:
        # Each entry is a thin pass-through to upstream. No defaults beyond
        # what upstream already supplies.
        p = params
        return {
            "resolve_short_url": lambda: client.resolve_short_url(
                p["short_url"],
                timeout_seconds=p.get("timeout_seconds", 10.0),
            ),
            "get_video_detail": lambda: client.get_video_detail(
                p["aweme_id"],
                suppress_error=p.get("suppress_error", False),
            ),
            "get_user_info": lambda: client.get_user_info(p["sec_uid"]),
            "get_user_post": lambda: client.get_user_post(
                p["sec_uid"],
                max_cursor=p.get("max_cursor", 0),
                count=p.get("count", 20),
            ),
            "get_user_like": lambda: client.get_user_like(
                p["sec_uid"],
                max_cursor=p.get("max_cursor", 0),
                count=p.get("count", 20),
            ),
            "get_user_mix": lambda: client.get_user_mix(
                p["sec_uid"],
                max_cursor=p.get("max_cursor", 0),
                count=p.get("count", 20),
            ),
            "get_user_music": lambda: client.get_user_music(
                p["sec_uid"],
                max_cursor=p.get("max_cursor", 0),
                count=p.get("count", 20),
            ),
            "get_user_collects": lambda: client.get_user_collects(
                p["sec_uid"],
                max_cursor=p.get("max_cursor", 0),
                count=p.get("count", 10),
            ),
            "get_collect_aweme": lambda: client.get_collect_aweme(
                p["collects_id"],
                max_cursor=p.get("max_cursor", 0),
                count=p.get("count", 10),
            ),
            "get_user_collect_mix": lambda: client.get_user_collect_mix(
                p["sec_uid"],
                max_cursor=p.get("max_cursor", 0),
                count=p.get("count", 12),
            ),
            "get_mix_detail": lambda: client.get_mix_detail(p["mix_id"]),
            "get_mix_aweme": lambda: client.get_mix_aweme(
                p["mix_id"],
                cursor=p.get("cursor", 0),
                count=p.get("count", 20),
            ),
            "get_music_detail": lambda: client.get_music_detail(p["music_id"]),
            "extract_aweme_assets": lambda: _async_return(
                extract_aweme_assets(client, p["aweme_data"])
            ),
            "extract_music_assets": lambda: _async_return(
                extract_music_assets(client, p["music_detail"])
            ),
            "sanitize_filename": lambda: _async_return(
                sanitize_filename(p["name"], p.get("max_length", 80))
            ),
            "collect_user_post_ids_via_browser": lambda: client.collect_user_post_ids_via_browser(
                p["sec_uid"],
                expected_count=p.get("expected_count", 0),
                headless=p.get("headless", False),
                max_scrolls=p.get("max_scrolls", 240),
                idle_rounds=p.get("idle_rounds", 8),
                wait_timeout_seconds=p.get("wait_timeout_seconds", 600),
            ),
        }

    async def _dispatch(self, method: str, params: Dict[str, Any]) -> Any:
        if method == "init":
            return await self._init(params)
        if method == "shutdown":
            return await self._shutdown()
        if method == "parse_url":
            return URLParser.parse(params["url"])

        if self._client is None:
            raise RuntimeError("init must be called before any API method")

        table = self._api_dispatch_table(self._client, params)
        handler = table.get(method)
        if handler is None:
            raise RuntimeError(f"Unknown method: {method}")
        return await handler()

    async def _handle_request(self, req: Dict[str, Any]) -> None:
        req_id = req.get("id")
        method = req.get("method")
        params = req.get("params") or {}

        if not isinstance(method, str):
            await self._send({
                "id": req_id,
                "error": {"code": "bad_request", "message": "missing method"},
            })
            return

        try:
            result = await self._dispatch(method, params)
            await self._send({"id": req_id, "result": result})
        except Exception as exc:
            await self._send({
                "id": req_id,
                "error": {
                    "code": type(exc).__name__,
                    "message": str(exc),
                    "trace": traceback.format_exc(),
                },
            })

    async def serve(self) -> None:
        await self._send({
            "type": "ready",
            "version": "1.0",
            "downloader_root": _DOWNLOADER_ROOT,
        })

        loop = asyncio.get_running_loop()
        # asyncio.StreamReader defaults limit=64KB per line. A round-trip of a
        # full aweme_detail dict (cover thumbnails, bit_rate ladder, music
        # info, etc.) routinely exceeds that, so we bump to 64MB. This is the
        # buffer for INCOMING requests from Node — extract_aweme_assets sends
        # the parsed aweme_data back to us as one JSON line.
        reader = asyncio.StreamReader(limit=64 * 1024 * 1024)
        protocol = asyncio.StreamReaderProtocol(reader)
        await loop.connect_read_pipe(lambda: protocol, sys.stdin)

        while True:
            line = await reader.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except json.JSONDecodeError as exc:
                await self._emit_event("log", level="error", message=f"Bad JSON: {exc}")
                continue

            method = req.get("method")
            await self._handle_request(req)
            if method == "shutdown":
                break

        if self._client is not None:
            try:
                await self._client.__aexit__(None, None, None)
            except Exception:
                pass


def main() -> None:
    try:
        asyncio.run(Sidecar().serve())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
