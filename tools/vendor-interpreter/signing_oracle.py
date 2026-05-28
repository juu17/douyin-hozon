#!/usr/bin/env python3
"""Golden-vector oracle for the native signing ports (Wave 3). DEV-ONLY.

The signers fold in time.time() (and a_bogus also random), so the same input
yields different output each call. This oracle freezes the clock (and seeds
random) to emit reproducible input->output vectors the TS tests assert against.

  python3 tools/vendor-interpreter/signing_oracle.py xbogus
    -> emits golden vectors for XBogus to stdout as JSON.

xbogus.py is stdlib-only (base64/hashlib/time), so it imports cleanly under a
bare python3. a_bogus (W3.3) needs gmssl and is added later.
"""
from __future__ import annotations

import importlib.util
import json
import os
import random
import sys
import time

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
VENDOR = os.path.join(REPO_ROOT, "douyin-downloader")

MAC_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# (label, url, user_agent_or_None, frozen_timer)
XBOGUS_CASES = [
    ("detail_default_ua", "https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7111111111111111111&device_platform=webapp&aid=6383", None, 1700000000),
    ("detail_mac_ua", "https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7222&aid=6383", MAC_UA, 1700000000),
    ("user_post", "https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id=MS4wLjABAAAA&count=18&max_cursor=0", MAC_UA, 1699999999),
    # NOTE: build() is only ever given full API URLs (>32 chars). The vendor's
    # _md5_str_to_array IndexErrors on short non-hex strings, so all fixtures
    # use realistic long URLs (matching production).
    ("music_detail", "https://www.douyin.com/aweme/v1/web/music/detail/?music_id=7044444444444444444&device_platform=webapp&aid=6383", None, 1234567890),
    ("late_timer", "https://www.douyin.com/aweme/v1/web/mix/aweme/?mix_id=7333&cursor=0&count=20", MAC_UA, 2000000000),
]


def load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, os.path.join(VENDOR, rel))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def oracle_xbogus() -> list[dict]:
    xb = load("oracle_xbogus", "utils/xbogus.py")
    out = []
    real_time = time.time
    try:
        for label, url, ua, timer in XBOGUS_CASES:
            time.time = lambda t=timer: float(t)  # freeze
            signer = xb.XBogus(user_agent=ua)
            signed_url, x_bogus, resolved_ua = signer.build(url)
            out.append({
                "label": label,
                "url": url,
                "user_agent": resolved_ua,
                "timer": timer,
                "x_bogus": x_bogus,
                "signed_url": signed_url,
            })
    finally:
        time.time = real_time
    return out


# a_bogus needs gmssl -> run under the dev venv:
#   .venv-dev/bin/python tools/vendor-interpreter/signing_oracle.py abogus
EDGE_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"
)
FIXED_FP = "1920|1080|1952|1170|0|30|0|0|1536|864|1536|864|1920|1080|24|24|Win32"
DETAIL_PARAMS = (
    "device_platform=webapp&aid=6383&channel=channel_pc_web"
    "&aweme_id=7380308675841297704&pc_client_type=1&version_code=290100"
    "&cookie_enabled=true&screen_width=1920&screen_height=1080&browser_name=Edge"
)
# (label, params, body, user_agent, fp, options, frozen_seconds)
ABOGUS_CASES = [
    ("get_short", "device_platform=webapp&aid=6383&aweme_id=7111", "", EDGE_UA, FIXED_FP, [0, 1, 8], 1700000000),
    ("get_long", DETAIL_PARAMS, "", EDGE_UA, FIXED_FP, [0, 1, 8], 1700000000),
    ("post_with_body", "device_platform=webapp&aid=6383", "aweme_type=0&item_id=7467485482314763572&play_delta=1", EDGE_UA, FIXED_FP, [0, 1, 14], 1700000000),
    ("post_options14_empty_body", DETAIL_PARAMS, "", EDGE_UA, FIXED_FP, [0, 1, 14], 1234567890),
    ("late_timer", "device_platform=webapp&aid=6383&mix_id=7333", "", EDGE_UA, FIXED_FP, [0, 1, 8], 2000000000),
]


def oracle_abogus() -> list[dict]:
    ab = load("oracle_abogus", "utils/abogus.py")
    out = []
    real_time, real_random = time.time, random.random
    try:
        for label, params, body, ua, fp, options, ts in ABOGUS_CASES:
            time.time = lambda t=ts: float(t)  # start == end
            random.random = lambda: 0.0  # generate_random_bytes -> [1,2,5,40]*3
            signer = ab.ABogus(fp=fp, user_agent=ua, options=options)  # FRESH per case
            signed_params, a_bogus, resolved_ua, resolved_body = signer.generate_abogus(params, body)
            out.append({
                "label": label,
                "params": params,
                "body": body,
                "user_agent": resolved_ua,
                "fp": fp,
                "options": options,
                "now_ms": int(ts * 1000),
                "random_bytes": [ord(c) for c in ab.StringProcessor.generate_random_bytes()],
                "a_bogus": a_bogus,
                "signed_params": signed_params,
            })
    finally:
        time.time, random.random = real_time, real_random
    return out


def main() -> None:
    which = sys.argv[1] if len(sys.argv) > 1 else "xbogus"
    if which == "xbogus":
        sys.stdout.write(json.dumps(oracle_xbogus(), ensure_ascii=False, indent=2) + "\n")
    elif which == "abogus":
        sys.stdout.write(json.dumps(oracle_abogus(), ensure_ascii=False, indent=2) + "\n")
    else:
        sys.stderr.write(f"unknown signer: {which}\n")
        sys.exit(2)


if __name__ == "__main__":
    main()
