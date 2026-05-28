# Maintainer guide — native parser, drift detection, break-glass

## Architecture

```
Ink TUI ─▶ TS Engine ─▶ native/  (parse + sign + signed HTTP, pure TypeScript)
                         └─ break-glass: Python sidecar (opt-in)
              ▲
   Vendor Interpreter (dev-only)  ─ diffs upstream vs the committed tally
```

The default runtime is **pure TypeScript** (`src/engine/native/`): URL parsing,
asset extraction, the X-Bogus / a_bogus / msToken signers, and the signed
`DouyinAPIClient`. No Python, no vendored repo at runtime.

The vendored `douyin-downloader` is a **dev-only reference**. It is fetched on
demand (`pnpm vendor:acquire`), never required to run the app, and gitignored.

## When douyin changes (the whole point)

douyin bumps its web API / anti-bot signing a few times a year. The native ports
are faithful translations of upstream, so a bump can break them. The **Vendor
Interpreter** catches this before users do.

### 1. Detect drift

```bash
pnpm vendor:check          # exit 0 = MATCH, 1 = DRIFTED, 2 = TOOLING error
```

It extracts the consumed upstream signatures (Python `ast`) and diffs them by
digest against `vendor-api/tally.json` (the committed snapshot of the ~27
symbols we depend on). Run it in CI and before a release. A `DRIFTED` result
names exactly which symbol changed (field- and param-level).

### 2. Fall back immediately (break-glass)

While you re-port, users (and you) can keep working on upstream's own signing:

```bash
DOUYIN_HOZON_PARSER=sidecar pnpm dev
```

This spawns `parser_sidecar.py` (needs Python 3 + the one-time venv from
`prerequisite.sh`). It is the only path that touches Python.

### 3. Re-port the affected surface

Each native module mirrors a vendor file and is verified by **golden vectors**
generated from the real Python — so a re-port is "translate, regenerate golden,
run tests until green".

| Drifted upstream | Native module | Golden / oracle |
|---|---|---|
| `core/url_parser.py`, `utils/validators.py` | `native/url-parser.ts`, `native/sanitize.ts` | hand vectors + cross-check vs Python |
| asset extraction (`downloader_base`) | `native/aweme-assets.ts`, `native/music-assets.ts` | `tools/vendor-interpreter/aweme_oracle.py` → `tests/native/fixtures/aweme-golden.json` |
| `utils/xbogus.py` | `native/signing/xbogus.ts` | `signing_oracle.py xbogus` → `xbogus-golden.json` |
| `utils/abogus.py` | `native/signing/abogus.ts` | `signing_oracle.py abogus` → `abogus-golden.json` (needs gmssl) |
| `auth/ms_token_manager.py` | `native/signing/mstoken.ts` | format/behaviour tests |
| `core/api_client.py` | `native/api-client.ts` | mocked-fetch tests |

The oracles freeze time + RNG so vectors are reproducible; the TS ports take
injectable `now` / `randomBytes` to match. `a_bogus` needs `gmssl`:

```bash
python3 -m venv .venv-dev && .venv-dev/bin/pip install gmssl pyyaml
.venv-dev/bin/python tools/vendor-interpreter/signing_oracle.py abogus > tests/native/fixtures/abogus-golden.json
pnpm test                  # native output must equal the new golden
```

### 4. Re-baseline the tally

Once the native port matches the new upstream behaviour:

```bash
pnpm vendor:check --accept   # rewrites vendor-api/tally.json to the new signatures
# or: pnpm vendor:baseline
```

Commit the `tally.json` + golden diffs — they are the audit trail.

## Notes

- Never delete `parser_sidecar.py` / `parser-client.ts` — they are the
  break-glass. They are dead weight in native mode, not dead code.
- `pnpm vendor:check` audits **source** signatures only; it does not run upstream
  or hit the network.
