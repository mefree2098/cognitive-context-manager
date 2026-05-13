# Troubleshooting

Run:

```bash
node dist/cli/ccm.js doctor
```

Common checks:

- Node must be 20 or newer.
- The database path must be writable.
- SQLite must support FTS5.
- `.codex-plugin/plugin.json`, `.mcp.json`, and `hooks/hooks.json` must parse.
- `dist/mcp/server.js` and `dist/hooks/hook-entry.js` must exist after build.

If hooks fail, Codex should continue working. Hook errors are logged to `$CCM_HOME/logs/ccm.log` with secrets redacted.

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
