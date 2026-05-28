# Changelog

All notable changes to Cognitive Context Manager are documented here.

## 0.3.5 - 2026-05-28

- Added the UI performance dashboard with effectiveness, token, reliability, embedding, daemon, memory-pressure, and readiness metrics.
- Added dashboard actions for refresh, embedding processing, hygiene preview, and confirmed duplicate-handoff archival.
- Enabled adaptive UI port selection and `ccm ui status` reporting for the selected localhost URL.
- Enabled OpenAI embeddings by default through existing Codex auth with local deterministic fallback.
- Added reporting for execution impact, memory pressure, passive hook proof, watchdog state, and publishing readiness.
- Added hygiene workflows for duplicate handoffs, attribution repair, quarantine, archive, and tombstone states.
- Added adaptive agent guidance under CCM-owned files with audit history and rollback.

## 0.3.0 - 2026-05-17

- Added the local Codex plugin manifest, MCP server, hooks, skill, CLI, SQLite storage, and core context-brief workflow.
