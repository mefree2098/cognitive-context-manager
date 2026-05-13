# Build Notes

This implementation follows the MVP from `cognitive-context-manager-codex-plugin-build.md`:

- TypeScript and Node
- SQLite with FTS5
- Hook entrypoint with tolerant parsing
- MCP tools backed by the same service layer as the CLI
- Local-first config and storage
- Tests for segmentation, salience, context building, storage, hooks, MCP wrappers, staleness, redaction, schema/trace/metrics, embeddings fallback, sync, AGENTS suggestions, adaptive agent guidance, hygiene/quarantine, and benchmarks

Run:

```bash
npm install
npm run check
node dist/cli/ccm.js doctor
```
