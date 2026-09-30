#!/usr/bin/env bash
# Rebuildable Codex Cloud environment; no production secrets or local library.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PROFILE="${TEST1_CLOUD_PROFILE:-development}"
[[ "$PROFILE" == development || "$PROFILE" == worker ]] || { echo 'Invalid profile' >&2; exit 1; }
VERSION="$(tr -d '\r\n' < .node-version)"
[[ "$VERSION" =~ ^22\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid Node version' >&2; exit 1; }
mkdir -p .runtime/test-tmp .runtime/task-artifacts/cloud-environment
export TEMP="$ROOT/.runtime/test-tmp" TMP="$ROOT/.runtime/test-tmp" TMPDIR="$ROOT/.runtime/test-tmp"
export PUPPETEER_SKIP_DOWNLOAD=true PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export NOVEL_CRAWLER_PYTHON=python3
if [[ "$(node --version 2>/dev/null || true)" != "v$VERSION" ]]; then
  [[ "$(uname -s)" == Linux ]] || { echo 'This setup requires Linux' >&2; exit 1; }
  case "$(uname -m)" in x86_64) ARCH=x64;; aarch64) ARCH=arm64;; *) echo 'Unsupported CPU' >&2; exit 1;; esac
  RUNTIME="node-v$VERSION-linux-$ARCH"
  if [[ ! -x ".runtime/$RUNTIME/bin/node" ]]; then
    STAGE="$(mktemp -d "$TMPDIR/node-install-XXXXXX")"
    curl --fail --silent --show-error --location "https://nodejs.org/dist/v$VERSION/$RUNTIME.tar.xz" -o "$STAGE/$RUNTIME.tar.xz"
    curl --fail --silent --show-error --location "https://nodejs.org/dist/v$VERSION/SHASUMS256.txt" -o "$STAGE/SHASUMS256.txt"
    (cd "$STAGE"; awk -v f="$RUNTIME.tar.xz" '$2 == f {print}' SHASUMS256.txt > selected.sha256; test -s selected.sha256; sha256sum --check selected.sha256)
    tar -xJf "$STAGE/$RUNTIME.tar.xz" -C .runtime
    rm -- "$STAGE/$RUNTIME.tar.xz" "$STAGE/SHASUMS256.txt" "$STAGE/selected.sha256"
    rmdir -- "$STAGE"
  fi
  export PATH="$ROOT/.runtime/$RUNTIME/bin:$PATH"
fi
command -v python3 >/dev/null
command -v git >/dev/null
npm ci --no-audit --no-fund
npm --prefix tools/novel-crawler ci --no-audit --no-fund
npm --prefix server ci --no-audit --no-fund
if [[ "$PROFILE" == development ]]; then
  npm --prefix web-next ci --no-audit --no-fund
fi
node infra/cloud/capacity.mjs > .runtime/task-artifacts/cloud-environment/installed.json
node --version
python3 --version
echo "Test1 $PROFILE environment installed. Capacity report: .runtime/task-artifacts/cloud-environment/installed.json"
