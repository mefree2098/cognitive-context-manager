# Installation

## Build Plugin

```bash
cd cognitive-context-manager
npm install
npm run build
npm run check
node dist/cli/ccm.js init
node dist/cli/ccm.js doctor
```

## Enable Hooks

Ensure your Codex config includes:

```toml
[features]
codex_hooks = true
```

Native Codex memories are optional:

```toml
[features]
memories = true
```

## Local Marketplace

Create or update:

```text
~/.agents/plugins/marketplace.json
```

Example:

```json
{
  "name": "local",
  "plugins": [
    {
      "source": {
        "path": "/absolute/path/to/cognitive-context-manager"
      },
      "interface": {
        "displayName": "Cognitive Context Manager"
      }
    }
  ]
}
```

Restart Codex, select the local marketplace, and install/enable the plugin.

## Verify MCP

In Codex, run:

```text
/mcp
```

Confirm `cognitive-context-manager` is active.

## Verify Skill

In Codex, run:

```text
/skills
```

Confirm `cognitive-context` is visible.
