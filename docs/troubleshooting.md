# Troubleshooting

Run:

```bash
node dist/cli/ccm.js doctor
```

Common checks:

- Node must be 20 or newer.
- The database path must be writable.
- SQLite must support FTS5.
- `.codex-plugin/plugin.json`, `.mcp.json`, root `hooks.json`, and `hooks/hooks.json` must parse.
- `dist/mcp/server.js` and `dist/hooks/hook-entry.js` must exist after build.
- The installed Codex plugin cache should contain root `hooks.json`, `hooks/hooks.json`, and `dist/hooks/hook-entry.js`.

If hooks fail, Codex should continue working. Hook errors are logged to `$CCM_HOME/logs/ccm.log` with secrets redacted.

`ccm doctor` may print a warning for passive hook capture recency. A warning does not block explicit MCP use, but it means the plugin should not be described as a proven silent always-on safety net until a fresh Codex Desktop restart plus normal prompt/tool activity produces recent hook traces.

Use the effectiveness report for live proof:

```bash
ccm report effectiveness --since 48h --format markdown
```

Look for `passiveHookStatus=recent`, nonzero passive hook coverage, and no hook failures. If the report says `passiveHookStatus=stale` or `not_seen`, verify `~/.codex/config.toml` has `[features].hooks = true`, confirm the plugin cache manifests are present, restart Codex Desktop, then run a normal workspace task.

For a clean passive-hook proof run, use `docs/passive-hook-test.md` and the watcher:

```bash
ccm hooks watch --seconds 600
```

If memory pressure is high or critical, run:

```bash
ccm hygiene report
ccm hygiene attribution
ccm hygiene duplicates
ccm memory list --limit 50
```

Archive or quarantine low-value repeated handoffs before using the report as publishing evidence. Use attribution repair when an open loop clearly belongs to another known project.

For post-MVP features:

```bash
ccm embeddings status
ccm daemon status
ccm sync status
ccm hygiene report
ccm trace tail
```

If hybrid retrieval behaves oddly, set `retrieval.mode` back to `fts` and rerun `ccm doctor`. If a memory looks suspicious, run `ccm memory quarantine <id>`.

For adaptive guidance:

```bash
ccm agents adaptive status
ccm agents adaptive diff
ccm agents adaptive history
```

If a rule looks wrong, reject the pending patch or roll back to the prior hash. The history file is `CCM_AGENTS.history.jsonl`.
