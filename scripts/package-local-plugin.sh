#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -e 'const fs=require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version)' "$ROOT/package.json")"
OUT_DIR="${1:-"$ROOT/release"}"
ARCHIVE_NAME="cognitive-context-manager-$VERSION-local.tar.gz"
ARCHIVE_PATH="$OUT_DIR/$ARCHIVE_NAME"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command node
require_command npm
require_command rsync
require_command tar

mkdir -p "$OUT_DIR"

(
  cd "$ROOT"
  npm run check
)

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
PACKAGE_ROOT="$TMP_DIR/cognitive-context-manager"
mkdir -p "$PACKAGE_ROOT"

rsync -a \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'release/' \
  --exclude 'bench/results/' \
  --exclude '.env' \
  --exclude '*.sqlite' \
  --exclude '*.sqlite-shm' \
  --exclude '*.sqlite-wal' \
  "$ROOT/" "$PACKAGE_ROOT/"

tar -C "$TMP_DIR" -czf "$ARCHIVE_PATH" cognitive-context-manager
(
  cd "$OUT_DIR"
  shasum -a 256 "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256"
)

cat <<EOF
Created local CCM plugin bundle:
  $ARCHIVE_PATH
  $ARCHIVE_PATH.sha256

Colleague install:
  tar -xzf "$ARCHIVE_NAME"
  cd cognitive-context-manager
  ./scripts/install-local-plugin.sh
EOF
