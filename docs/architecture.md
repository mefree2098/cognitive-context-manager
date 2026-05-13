# Architecture

Cognitive Context Manager uses three Codex extension surfaces:

- Hooks capture passive lifecycle activity.
- MCP tools provide active retrieval and memory operations.
- A skill teaches Codex when to call those tools.

The storage layer is local SQLite. Events and memories are typed, salience-scored, confidence-scored, and staleness-aware. Retrieval uses SQLite FTS5 plus metadata filters, recency, salience, and confidence.

The context builder returns a brief, not a transcript. It prefers semantic memories over episodic memories, open loops over older chatter, and current project evidence over memory.

## Post-MVP Layer

Version 0.2 adds optional services around the same SQLite store:

- `trace_entries` explain hook and retrieval decisions.
- `embeddings` and `embedding_jobs` enable opt-in hybrid retrieval while FTS remains default.
- `consolidation_jobs` gives the daemon an idempotent queue surface.
- `metrics` powers context-dividend reporting.
- `agents_suggestions` stores explicit AGENTS.md diffs for user approval.
- `sync_records` tracks encrypted file-sync bundles.
- `entities`, `entity_edges`, and `memory_entities` provide the graph-ready storage layer.
- `adaptive_agent_versions` and `adaptive_agent_patches` manage CCM-owned adaptive instructions with rollback.

All advanced features are off or inert by default. If embeddings, daemon, GUI, or sync fail, the original hook/MCP/FTS path remains available.

## Adaptive Agent Guidance

CCM owns a separate guidance file at `~/.codex/ccm/agents/CCM_AGENTS.md` by default, or `$CCM_HOME/agents/CCM_AGENTS.md` during isolated runs. Hooks can learn durable CCM-behavior corrections and update that file when thresholds and safety checks pass.

This file is not Codex `AGENTS.md`. It is treated as lower priority than project instructions and is injected only as compact contextual guidance in CCM briefs.
