#!/usr/bin/env python3
"""Golden-parity oracle for the native extract_aweme_assets port (W2.3). DEV-ONLY.

parser_sidecar.py can't be imported directly under a bare python3 (its module
load pulls in the vendor api_client -> aiohttp/gmssl). So we ast-extract just
the PURE extraction functions' source from parser_sidecar.py and exec them in a
namespace that provides a deterministic stub api_client and the REAL
sanitize_filename (utils/validators.py imports cleanly, no aiohttp). The result
is the genuine upstream-lifted logic run against our fixtures.

Usage:  python3 tools/vendor-interpreter/aweme_oracle.py <fixtures.json>
Emits:  {"<name>": <AwemeAssetBundle>, ...} as JSON on stdout.
Pin TZ=UTC so publish_date is reproducible across machines.
"""
from __future__ import annotations

import ast
import importlib.util
import json
import os
import sys
from datetime import datetime as _dt  # noqa: F401  (used by exec'd bodies)
from typing import Any, Dict, List as _List, Optional, Tuple as _Tuple  # noqa: F401
from urllib.parse import urlparse as _urlparse  # noqa: F401

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SIDECAR = os.path.join(REPO_ROOT, "parser_sidecar.py")
VENDOR = os.path.join(REPO_ROOT, "douyin-downloader")

# Real sanitize_filename — validators.py is stdlib-only, imports fine.
_v_spec = importlib.util.spec_from_file_location(
    "oracle_validators", os.path.join(VENDOR, "utils", "validators.py")
)
_v = importlib.util.module_from_spec(_v_spec)
_v_spec.loader.exec_module(_v)
sanitize_filename = _v.sanitize_filename  # noqa: F811


class _StubApiClient:
    """Deterministic stand-in for DouyinAPIClient — only the surface the pure
    extractors touch. Mirror these exactly in the TS test's mock signer."""

    BASE_URL = "https://www.douyin.com"
    headers = {"User-Agent": "UA-TEST"}

    def sign_url(self, url):
        return url + "&X-Bogus=MOCK", "UA-SIGNED"

    def build_signed_path(self, path, params):
        query = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{self.BASE_URL}{path}?{query}&X-Bogus=MOCK", "UA-SIGNED"


# Names to lift out of parser_sidecar.py (functions + the one module constant).
WANT_FUNCS = {
    "_resolve_publish",
    "_pick_highest_quality_play_addr",
    "_extract_first_url",
    "_pick_first_media_url",
    "_iter_gallery_items",
    "_detect_media_type",
    "_download_headers",
    "_select_video_asset",
    "_select_image_assets",
    "_select_image_live_assets",
    "extract_aweme_assets",
}
WANT_ASSIGNS = {"_GALLERY_AWEME_TYPES"}


def _extract_namespace() -> Dict[str, Any]:
    src = open(SIDECAR, encoding="utf-8").read()
    tree = ast.parse(src)
    pieces: list[str] = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in WANT_FUNCS:
            pieces.append(ast.get_source_segment(src, node))
        elif isinstance(node, ast.Assign):
            names = {t.id for t in node.targets if isinstance(t, ast.Name)}
            if names & WANT_ASSIGNS:
                pieces.append(ast.get_source_segment(src, node))
    ns: Dict[str, Any] = {
        "_dt": _dt,
        "_urlparse": _urlparse,
        "_List": _List,
        "_Tuple": _Tuple,
        "Optional": Optional,
        "Dict": Dict,
        "Any": Any,
        "sanitize_filename": sanitize_filename,
    }
    exec(compile("\n\n".join(pieces), SIDECAR, "exec"), ns)
    return ns


def main() -> None:
    if len(sys.argv) != 2:
        sys.stderr.write("usage: aweme_oracle.py <fixtures.json>\n")
        sys.exit(2)
    ns = _extract_namespace()
    extract = ns["extract_aweme_assets"]
    api = _StubApiClient()
    cases = json.load(open(sys.argv[1], encoding="utf-8"))
    out = {c["name"]: extract(api, c["aweme_data"]) for c in cases}
    sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
