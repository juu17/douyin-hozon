#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Native is the default: pure TypeScript, no Python, no vendored repo.
# `clone -> pnpm install -> pnpm dev` just works. The vendored
# douyin-downloader is a dev-only reference (see tools/vendor-interpreter,
# `pnpm vendor:check`) and is fetched on demand, not at startup.
if [[ "${DOUYIN_HOZON_PARSER:-native}" != "sidecar" ]]; then
  echo "douyin-hozon: native mode (pure TypeScript). No Python prerequisites needed."
  echo "  (set DOUYIN_HOZON_PARSER=sidecar to use the legacy Python break-glass.)"
  exit 0
fi

# --- DOUYIN_HOZON_PARSER=sidecar break-glass: vendored Python repo + venv ---
DEFAULT_REPO_URL="https://github.com/jiji262/douyin-downloader.git"

# Pinned upstream commit. Bump intentionally after `pnpm vendor:check` confirms
# the consumed signatures still match (vendor-api/tally.json).
PINNED_COMMIT="c3ff1df2c52cd1122eefffd6e5ebad61e957b045"

if [[ -n "${DOUYIN_HOZON_DOWNLOADER_PATH:-}" ]]; then
  TARGET_DIR="${DOUYIN_HOZON_DOWNLOADER_PATH}"
  if [[ ! -f "${TARGET_DIR}/core/api_client.py" ]]; then
    echo "DOUYIN_HOZON_DOWNLOADER_PATH is set, but core/api_client.py was not found at: ${TARGET_DIR}" >&2
    exit 1
  fi
  echo "Using external douyin-downloader at ${TARGET_DIR} (pin not enforced)"
else
  TARGET_DIR="${ROOT_DIR}/douyin-downloader"
  if [[ -d "${TARGET_DIR}/.git" ]]; then
    echo "Updating douyin-downloader in ${TARGET_DIR} (target ${PINNED_COMMIT})"
    git -C "${TARGET_DIR}" fetch --quiet origin
    git -C "${TARGET_DIR}" checkout --quiet "${PINNED_COMMIT}"
  elif [[ -f "${TARGET_DIR}/core/api_client.py" ]]; then
    echo "Found douyin-downloader in ${TARGET_DIR} without Git metadata; skipping checkout."
  elif [[ -e "${TARGET_DIR}" ]]; then
    echo "Path exists but does not look like douyin-downloader: ${TARGET_DIR}" >&2
    exit 1
  else
    echo "Cloning douyin-downloader into ${TARGET_DIR}"
    git clone --quiet "${DEFAULT_REPO_URL}" "${TARGET_DIR}"
    git -C "${TARGET_DIR}" checkout --quiet "${PINNED_COMMIT}"
  fi

  if [[ ! -f "${TARGET_DIR}/core/api_client.py" ]]; then
    echo "douyin-downloader is still missing core/api_client.py after prerequisite setup." >&2
    exit 1
  fi
fi

# Parser sidecar's Python virtualenv.
VENV_DIR="${ROOT_DIR}/.venv"
PY_BIN="$(command -v python3 || command -v python || true)"
if [[ -z "${PY_BIN}" ]]; then
  echo "python3 (or python) not found in PATH" >&2
  exit 1
fi

if [[ ! -d "${VENV_DIR}" ]]; then
  echo "Creating Python venv at ${VENV_DIR}"
  "${PY_BIN}" -m venv "${VENV_DIR}"
fi

REQ_FILE="${ROOT_DIR}/parser_sidecar.requirements.txt"
REQ_STAMP="${VENV_DIR}/.requirements.sha256"
REQ_HASH="$(shasum -a 256 "${REQ_FILE}" | awk '{print $1}')"

if [[ ! -f "${REQ_STAMP}" || "$(cat "${REQ_STAMP}")" != "${REQ_HASH}" ]]; then
  echo "Installing parser sidecar Python deps"
  "${VENV_DIR}/bin/pip" install --quiet --upgrade pip
  "${VENV_DIR}/bin/pip" install --quiet -r "${REQ_FILE}"
  echo "${REQ_HASH}" > "${REQ_STAMP}"
fi

echo "douyin-hozon sidecar break-glass ready (downloader at ${TARGET_DIR}, venv at ${VENV_DIR})"
