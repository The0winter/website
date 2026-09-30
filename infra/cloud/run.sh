#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
VERSION="$(tr -d '\r\n' < .node-version)"
case "$(uname -m)" in x86_64) ARCH=x64;; aarch64) ARCH=arm64;; *) echo 'Unsupported CPU' >&2; exit 1;; esac
if [[ -x ".runtime/node-v$VERSION-linux-$ARCH/bin/node" ]]; then
  export PATH="$ROOT/.runtime/node-v$VERSION-linux-$ARCH/bin:$PATH"
fi
[[ "$(node --version)" == "v$VERSION" ]] || { echo 'Run bash infra/cloud/setup.sh first' >&2; exit 1; }
export NOVEL_CRAWLER_PYTHON=python3
# Non-secret development defaults; cloud builds must not borrow production env files.
export INTERNAL_API_URL="${INTERNAL_API_URL:-http://127.0.0.1:5000/api}"
export NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-http://127.0.0.1:3000}"
export NEXT_PUBLIC_EXTERNAL_SERVICES="${NEXT_PUBLIC_EXTERNAL_SERVICES:-disabled}"
export NEXT_PUBLIC_ANALYTICS_ENABLED="${NEXT_PUBLIC_ANALYTICS_ENABLED:-disabled}"
export TEMP="$ROOT/.runtime/test-tmp" TMP="$ROOT/.runtime/test-tmp" TMPDIR="$ROOT/.runtime/test-tmp"
mkdir -p "$TMPDIR"
exec "$@"
