# Codex Integration

The plugin manifest lives at `.codex-plugin/plugin.json`.

The MCP server config lives at `.mcp.json` and runs:

```bash
node ./dist/mcp/server.js
```

Hook configuration lives at `hooks/hooks.json` and calls:

```bash
node ./dist/hooks/hook-entry.js <LifecycleEvent>
```

The hook entrypoint resolves the installed plugin root from its own compiled file location and uses the session working directory only as project evidence.
