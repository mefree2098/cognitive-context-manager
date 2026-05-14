# Cognitive Context Manager

Cognitive Context Manager is a local-first Codex plugin that captures session events, consolidates them into typed memories, and exposes compact working-context briefs through MCP tools.

It is meant to support long Codex flows without dumping raw transcripts into the live prompt. Hooks passively capture meaningful events. The MCP server lets Codex actively retrieve context, search memories, record decisions, and compact a session handoff.

## What It Provides

- Codex plugin manifest in `.codex-plugin/plugin.json`
- Lifecycle hooks in `hooks/hooks.json`
- MCP server in `src/mcp/server.ts`
- Skill instructions in `skills/cognitive-context/SKILL.md`
- SQLite storage at `~/.codex/cognitive-context-manager/ccm.sqlite`
- CLI commands through `ccm`
- Local-only deterministic FTS retrieval
- Secret redaction before every memory write
- Post-MVP trace explainability, schema safety, metrics, optional embeddings, daemon jobs, encrypted file sync, AGENTS.md suggestions, hygiene/quarantine, benchmarks, and localhost UI
- Adaptive Agent Guidance in CCM-owned `CCM_AGENTS.md`, with audit history, pending patches, rollback, and compact context-brief injection

## Quick Start

```bash
npm install
npm run build
npm run check
node dist/cli/ccm.js init
node dist/cli/ccm.js doctor
```

Enable Codex hooks:

```toml
[features]
codex_hooks = true
```

Add the plugin to a local marketplace entry pointing at this directory, then restart Codex and verify the `cognitive-context` skill and `cognitive-context-manager` MCP server are visible.

## Core MCP Tools

- `get_working_context`
- `search_memories`
- `explain_retrieval`
- `preview_context_brief`
- `get_project_state`
- `get_open_loops`
- `get_recent_events`
- `get_artifact_state`
- `record_decision`
- `record_preference`
- `record_open_loop`
- `resolve_open_loop`
- `mark_stale`
- `resolve_conflict`
- `reconcile_conflicts`
- `compact_session`
- `explain_memory`
- `forget_memory`
- `quarantine_memory`
- `summarize_tool_output`
- `get_context_dividend`
- `get_memory_health`
- `get_embedding_status`
- `get_sync_status`
- `suggest_agents_md_update`
- `get_adaptive_agent_guidance`
- `preview_adaptive_agent_patch`
- `propose_adaptive_agent_patch`
- `apply_adaptive_agent_patch`
- `reject_adaptive_agent_patch`
- `rollback_adaptive_agent_guidance`
- `explain_adaptive_agent_rule`

## CLI Examples

```bash
ccm status
ccm db verify
ccm trace explain --latest
ccm context preview --query "resume this refactor"
ccm context dividend
ccm report effectiveness --since 7d --format markdown
ccm memory search "theme system"
ccm memory show <memory-id>
ccm memory forget <memory-id>
ccm memory quarantine <memory-id>
ccm project summary
ccm embeddings status
ccm daemon status
ccm sync status
ccm hygiene report
ccm bench run
ccm agents adaptive status
ccm agents adaptive preview
ccm agents adaptive propose --text "Going forward, keep CCM context compact."
ccm agents adaptive apply
ccm agents adaptive rollback --to last
ccm export --project current --out ./ccm-export.json
```

## Post-MVP Features

Advanced features are opt-in and fail back to SQLite + FTS:

- Embeddings: disabled by default. Use `embeddings.enabled=true` and provider `local`, `lmstudio`, `openai`, or `custom`.
- Daemon: optional queue processor for embeddings and hygiene. Hooks and MCP work without it.
- Sync: disabled by default. File sync writes encrypted bundles with a local key.
- UI: optional dashboard bound to `127.0.0.1` by default through `ccm ui start`.
- AGENTS.md suggestions: CCM can propose diffs, but only `ccm agents apply <id>` writes.
- Adaptive Agent Guidance: CCM may update its own managed `~/.codex/ccm/agents/CCM_AGENTS.md`, but it never silently edits project or global `AGENTS.md` files.
- Hygiene: archive/quarantine/tombstone workflows keep low-value or suspicious memories out of context.

## Privacy

CCM does not send telemetry and does not require cloud services. Cloud embeddings or summarization require explicit configuration. Secrets are redacted before storage, embedding, summarization, sync, export, and context injection. Retrieved memory is wrapped as contextual data and never outranks AGENTS.md or higher-priority Codex instructions.
