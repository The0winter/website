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
export TEMP="$ROOT/.runtime/test-tmp" TMP="$ROOT/.runtime/test-tmp" TMPDIR="$ROOT/.runtime/test-tmp"
mkdir -p "$TMPDIR"
exec "$@"
