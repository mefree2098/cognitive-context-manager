# Installation

## Codex Desktop Local Plugin

From a clone or extracted release bundle:

```bash
cd cognitive-context-manager
./scripts/install-local-plugin.sh
```

The installer:

- copies CCM into `~/.codex/local-marketplaces/ccm/plugins/cognitive-context-manager`
- writes `~/.codex/local-marketplaces/ccm/.agents/plugins/marketplace.json`
- enables `[features].hooks = true` and `[features].memories = true` in `~/.codex/config.toml`
- enables `[plugins."cognitive-context-manager@local"]`
- runs `npm ci`, `npm run build`, `npm prune --omit=dev`, `ccm init`, and `ccm doctor`

Restart Codex Desktop after the installer finishes. In Plugins, choose the Local marketplace if needed and enable Cognitive Context Manager.

## Shareable Bundle

Package a tested tarball:

```bash
npm run package:local
```

This creates:

```text
release/cognitive-context-manager-<version>-local.tar.gz
release/cognitive-context-manager-<version>-local.tar.gz.sha256
```

A colleague can install it with:

```bash
tar -xzf cognitive-context-manager-<version>-local.tar.gz
cd cognitive-context-manager
./scripts/install-local-plugin.sh
```

## Manual Marketplace Fallback

If you need to inspect or repair the marketplace entry manually, the installer writes this shape:

```json
{
  "name": "local",
  "interface": {
    "displayName": "Local"
  },
  "plugins": [
    {
      "name": "cognitive-context-manager",
      "source": {
        "source": "local",
        "path": "./plugins/cognitive-context-manager"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

The marketplace directory itself should be registered in `~/.codex/config.toml`:

```toml
[features]
hooks = true
memories = true

[marketplaces.local]
source_type = "local"
source = "/Users/<you>/.codex/local-marketplaces/ccm"

[plugins."cognitive-context-manager@local"]
enabled = true
```

Older Codex builds used `codex_hooks = true`; current Codex Desktop expects `hooks = true`.

## Verify

In Codex:

```text
/skills
/mcp
```

You should see the `cognitive-context` skill and the `cognitive-context-manager` MCP server.

From Terminal:

```bash
cd ~/.codex/local-marketplaces/ccm/plugins/cognitive-context-manager
node dist/cli/ccm.js doctor
node dist/cli/ccm.js report effectiveness --since 1h --format markdown
```
