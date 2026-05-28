#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="cognitive-context-manager"
DISPLAY_NAME="Cognitive Context Manager"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKETPLACE_DIR="${CCM_MARKETPLACE_DIR:-"$HOME/.codex/local-marketplaces/ccm"}"
PLUGIN_DIR="${CCM_PLUGIN_DIR:-"$MARKETPLACE_DIR/plugins/$PLUGIN_NAME"}"
CONFIG_PATH="${CODEX_CONFIG_PATH:-"$HOME/.codex/config.toml"}"
SKIP_NPM=0
SKIP_CONFIG=0
SKIP_CACHE=0

usage() {
  cat <<'EOF'
Install Cognitive Context Manager into a local Codex marketplace.

Usage:
  ./scripts/install-local-plugin.sh [options]

Options:
  --marketplace-dir PATH  Local marketplace directory. Default: ~/.codex/local-marketplaces/ccm
  --plugin-dir PATH       Installed plugin directory. Default: <marketplace-dir>/plugins/cognitive-context-manager
  --config PATH           Codex config.toml path. Default: ~/.codex/config.toml
  --skip-npm              Skip npm install/build/prune. Intended only for tests.
  --skip-config           Do not edit Codex config.toml.
  --skip-cache            Do not refresh Codex's local plugin cache copy.
  -h, --help              Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --marketplace-dir)
      MARKETPLACE_DIR="$2"
      PLUGIN_DIR="$MARKETPLACE_DIR/plugins/$PLUGIN_NAME"
      shift 2
      ;;
    --plugin-dir)
      PLUGIN_DIR="$2"
      shift 2
      ;;
    --config)
      CONFIG_PATH="$2"
      shift 2
      ;;
    --skip-npm)
      SKIP_NPM=1
      shift
      ;;
    --skip-config)
      SKIP_CONFIG=1
      shift
      ;;
    --skip-cache)
      SKIP_CACHE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command node
require_command npm
require_command rsync

node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 20) { console.error(`Node 20+ is required; found ${process.version}`); process.exit(1); }'

mkdir -p "$MARKETPLACE_DIR/.agents/plugins" "$MARKETPLACE_DIR/plugins" "$(dirname "$CONFIG_PATH")"

SOURCE_REAL="$(cd "$SOURCE_DIR" && pwd -P)"
PLUGIN_PARENT="$(dirname "$PLUGIN_DIR")"
mkdir -p "$PLUGIN_PARENT"
PLUGIN_REAL_PARENT="$(cd "$PLUGIN_PARENT" && pwd -P)"
if [[ -e "$PLUGIN_DIR" ]]; then
  PLUGIN_REAL="$(cd "$PLUGIN_DIR" && pwd -P)"
else
  PLUGIN_REAL="$PLUGIN_REAL_PARENT/$(basename "$PLUGIN_DIR")"
fi
MARKETPLACE_REAL="$(cd "$MARKETPLACE_DIR" && pwd -P)"
PLUGIN_PATH_FOR_MARKETPLACE="$PLUGIN_REAL"
case "$PLUGIN_REAL" in
  "$MARKETPLACE_REAL"/*)
    PLUGIN_PATH_FOR_MARKETPLACE="./${PLUGIN_REAL#"$MARKETPLACE_REAL"/}"
    ;;
esac

if [[ "$SOURCE_REAL" != "$PLUGIN_REAL" ]]; then
  mkdir -p "$PLUGIN_DIR"
  rsync -a --delete \
    --exclude '.git/' \
    --exclude 'node_modules/' \
    --exclude 'release/' \
    --exclude 'bench/results/' \
    --exclude '.env' \
    --exclude '*.sqlite' \
    --exclude '*.sqlite-shm' \
    --exclude '*.sqlite-wal' \
    "$SOURCE_DIR/" "$PLUGIN_DIR/"
fi

node - "$MARKETPLACE_DIR/.agents/plugins/marketplace.json" "$PLUGIN_NAME" "$PLUGIN_PATH_FOR_MARKETPLACE" <<'NODE'
const fs = require("node:fs");

const [marketplacePath, pluginName, pluginPath] = process.argv.slice(2);
const marketplace = {
  name: "local",
  interface: {
    displayName: "Local"
  },
  plugins: [
    {
      name: pluginName,
      source: {
        source: "local",
        path: pluginPath
      },
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_INSTALL"
      },
      category: "Productivity"
    }
  ]
};

fs.writeFileSync(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);
NODE

if [[ "$SKIP_NPM" -eq 0 ]]; then
  (
    cd "$PLUGIN_DIR"
    npm ci --include=dev
    npm run build
    if [[ "$SOURCE_REAL" != "$PLUGIN_REAL" ]]; then
      npm prune --omit=dev
    fi
  )
fi

if [[ "$SKIP_CACHE" -eq 0 ]]; then
  PLUGIN_VERSION="$(node -e "console.log(require(process.argv[1]).version)" "$PLUGIN_DIR/package.json")"
  CACHE_DIR="${CCM_CODEX_CACHE_DIR:-"$HOME/.codex/plugins/cache/local/$PLUGIN_NAME/$PLUGIN_VERSION"}"
  CACHE_REAL_PARENT="$(dirname "$CACHE_DIR")"
  mkdir -p "$CACHE_REAL_PARENT"
  if [[ "$PLUGIN_REAL" != "$(mkdir -p "$CACHE_DIR" && cd "$CACHE_DIR" && pwd -P)" ]]; then
    rsync -a --delete \
      --exclude '.git/' \
      --exclude 'release/' \
      --exclude 'bench/results/' \
      --exclude '.env' \
      --exclude '*.sqlite' \
      --exclude '*.sqlite-shm' \
      --exclude '*.sqlite-wal' \
      "$PLUGIN_DIR/" "$CACHE_DIR/"
  fi
fi

if [[ "$SKIP_CONFIG" -eq 0 ]]; then
  node - "$CONFIG_PATH" "$MARKETPLACE_DIR" "$PLUGIN_NAME" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [configPath, marketplaceDir, pluginName] = process.argv.slice(2);
fs.mkdirSync(path.dirname(configPath), { recursive: true });
let text = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";

function tomlString(value) {
  return JSON.stringify(value);
}

function upsertTable(input, tableName, entries, removeKeys = []) {
  const lines = input.split(/\r?\n/);
  let start = -1;
  let end = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*\[([^\]]+)\]\s*$/.exec(lines[index]);
    if (!match) continue;
    if (match[1] === tableName) {
      start = index;
      for (let scan = index + 1; scan < lines.length; scan += 1) {
        if (/^\s*\[[^\]]+\]\s*$/.test(lines[scan])) {
          end = scan;
          break;
        }
      }
      break;
    }
  }

  const keys = new Set([...Object.keys(entries), ...removeKeys]);
  const renderedEntries = Object.entries(entries).map(([key, value]) => `${key} = ${value}`);
  if (start === -1) {
    const prefix = input.trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}[${tableName}]\n${renderedEntries.join("\n")}\n`;
  }

  const before = lines.slice(0, start + 1);
  const body = lines.slice(start + 1, end).filter((line) => {
    const match = /^\s*([A-Za-z0-9_.-]+)\s*=/.exec(line);
    return !match || !keys.has(match[1]);
  });
  const after = lines.slice(end);
  return [...before, ...body, ...renderedEntries, ...after].join("\n").replace(/\n{3,}/g, "\n\n");
}

text = upsertTable(text, "features", { hooks: "true", memories: "true" }, ["codex_hooks"]);
text = upsertTable(text, "marketplaces.local", {
  source_type: tomlString("local"),
  source: tomlString(marketplaceDir),
  last_updated: tomlString(new Date().toISOString().replace(/\.\d{3}Z$/, "Z"))
});
text = upsertTable(text, `plugins."${pluginName}@local"`, { enabled: "true" });

fs.writeFileSync(configPath, text.endsWith("\n") ? text : `${text}\n`);
NODE
fi

(
  cd "$PLUGIN_DIR"
  node dist/cli/ccm.js init
  node dist/cli/ccm.js doctor
)

cat <<EOF

Installed $DISPLAY_NAME.

Marketplace:
  $MARKETPLACE_DIR

Plugin:
  $PLUGIN_DIR

Codex plugin cache:
  ${CACHE_DIR:-"(skipped)"}

Codex config:
  $CONFIG_PATH

Next:
  1. Quit and reopen Codex Desktop.
  2. In Plugins, choose the Local marketplace if needed and enable "$DISPLAY_NAME".
  3. In a Codex chat, run /skills and /mcp to verify it is visible.
  4. After a normal task, run:
     cd "$PLUGIN_DIR" && node dist/cli/ccm.js report effectiveness --since 1h --format markdown
EOF
