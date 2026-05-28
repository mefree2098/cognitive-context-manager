# Cognitive Context Manager

[![CI](https://github.com/mefree2098/cognitive-context-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/mefree2098/cognitive-context-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<p align="center">
  <img src="assets/ccm-icon-256.png" alt="Cognitive Context Manager icon" width="128" height="128">
</p>

Cognitive Context Manager is a local-first Codex plugin that captures session events, consolidates them into typed memories, and exposes compact working-context briefs through MCP tools.

It is meant to support long Codex flows without dumping raw transcripts into the live prompt. The MCP server lets Codex actively retrieve context, search memories, record decisions, and compact a session handoff. Passive hook capture is available as a diagnostic/automation path, but users should verify it with `ccm doctor` and `ccm hooks watch` before treating it as an always-on safety net.

## The Idea

CCM started from a simple observation: human beings do not stay coherent across long projects by remembering every word of every conversation. We keep a small working set in mind, consolidate important episodes into longer-lived memory, remember unresolved intentions, notice emotionally or operationally salient moments, and retrieve related context when a new situation resembles something we have seen before.

Long-running Codex sessions need a similar support system. A model context window is more like working memory than long-term memory: it is powerful, but finite, noisy, and eventually compressed. If a session waits until the context window is nearly full before summarizing, important decisions, failed attempts, file state, and open loops can get flattened into a vague handoff. CCM tries to avoid that cliff by doing continuous micro-consolidation throughout the work.

In practice, CCM gives Codex a lightweight cognitive loop around the normal chat:

```text
Codex/user activity
  -> meaningful events are captured or explicitly recorded
  -> events are segmented into memory capsules
  -> important details are promoted into typed project memory
  -> open loops, decisions, artifacts, warnings, and preferences stay queryable
  -> Codex asks for a compact working-context brief before continuing
  -> stale or contradictory memories are flagged instead of blindly reused
```

The plugin deliberately stores different kinds of memory instead of throwing everything into one undifferentiated bucket:

- **Episodic memory:** what happened in a particular turn, run, failure, recovery, or handoff.
- **Semantic memory:** stable project facts, decisions, and current state.
- **Procedural memory:** durable conventions and repeated workflow rules.
- **Open-loop memory:** unresolved tasks, blockers, questions, and next actions.
- **Artifact memory:** file, build, test, generated-output, and checkpoint state.
- **Safety memory:** redacted secret events, risky patterns, and protected boundaries.

Retrieval is staged for the same reason human recall is contextual. Before a task, Codex can ask CCM for the current working context, project state, open loops, artifact state, or related memories. CCM then returns a bounded context brief, not a raw transcript dump. Current files, tool output, AGENTS.md, and higher-priority instructions still win; CCM memory is supporting context, not authority.

The result is not a bigger context window. It is a cleaner one: less repeated re-explanation, fewer lost decisions after compaction, better resume points for long-running tasks, and a way to measure whether the memory layer is actually helping through effectiveness reports and the dashboard.

## Release Status

CCM is in public beta. Explicit skill/MCP use, local storage, context briefs, embeddings, hygiene, and the dashboard are the best-supported paths today. Passive hook capture depends on the Codex host environment and should be reported as verified only when `passiveHookProof=host_launch_and_trace_proven` appears in `ccm report effectiveness`.

## What It Provides

- Codex plugin manifest in `.codex-plugin/plugin.json`
- Lifecycle hooks in root `hooks.json`, mirrored in `hooks/hooks.json`
- MCP server in `src/mcp/server.ts`
- Skill instructions in `skills/cognitive-context/SKILL.md`
- SQLite storage at `~/.codex/cognitive-context-manager/ccm.sqlite`
- CLI commands through `ccm`
- Hybrid retrieval with OpenAI embeddings through existing Codex auth, plus local deterministic fallback
- Secret redaction before every memory write
- Post-MVP trace explainability, schema safety, metrics, default embeddings, daemon jobs, encrypted file sync, AGENTS.md suggestions, hygiene/quarantine, benchmarks, and localhost UI
- Effectiveness reporting with passive-hook recency, memory-pressure, checkpoint/resume, and context-dividend signals
- Adaptive Agent Guidance in CCM-owned `CCM_AGENTS.md`, with audit history, pending patches, rollback, and compact context-brief injection

## Quick Start

For Codex Desktop, the easiest path is the local-plugin installer:

```bash
git clone https://github.com/mefree2098/cognitive-context-manager.git
cd cognitive-context-manager
./scripts/install-local-plugin.sh
```

Then quit and reopen Codex Desktop, select the Local marketplace if needed, and enable Cognitive Context Manager. The installer copies the plugin into `~/.codex/local-marketplaces/ccm`, builds it, initializes local storage, enables `hooks = true` and `memories = true`, and runs `ccm doctor`.

To create a shareable bundle for another Mac:

```bash
npm run package:local
```

See [docs/colleague-trial.md](docs/colleague-trial.md) for the full colleague handoff, verification steps, and troubleshooting.

For development:

```bash
npm install
npm run check
node dist/cli/ccm.js doctor
```

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

Advanced features fail back to SQLite + FTS or local-only behavior:

- Embeddings: enabled by default. CCM uses `~/.codex/auth.json` Codex ChatGPT auth for OpenAI embeddings, unless `embeddings.openai.authMode`, `embeddings.provider`, or `embeddings.enabled=false` says otherwise. If Codex auth is unavailable, it falls back to local deterministic embeddings.
- Daemon: optional queue processor for embeddings and hygiene. Hooks and MCP work without it.
- Sync: disabled by default. File sync writes encrypted bundles with a local key.
- UI: optional dashboard bound to `127.0.0.1:4388` by default through `ccm ui start`; it shows effectiveness, token savings, retrieval, reliability, embedding, daemon, memory-pressure, and readiness metrics. It also includes action buttons for refreshing the report, processing embedding jobs, previewing hygiene, and archiving duplicate compact-session handoffs. If that port is busy, CCM scans upward and reports the selected URL.
- AGENTS.md suggestions: CCM can propose diffs, but only `ccm agents apply <id>` writes.
- Adaptive Agent Guidance: CCM may update its own managed `~/.codex/ccm/agents/CCM_AGENTS.md`, but it never silently edits project or global `AGENTS.md` files.
- Hygiene: archive/quarantine/tombstone workflows keep low-value or suspicious memories out of context.

## Privacy

CCM does not send telemetry. OpenAI embeddings are enabled by default through existing Codex auth and redact text before requests; set `embeddings.enabled=false`, `embeddings.provider=local`, or `privacy.allowCloudEmbeddings=false` for a fully local embedding path. Cloud summarization still requires explicit configuration. Secrets are redacted before storage, embedding, summarization, sync, export, and context injection. Retrieved memory is wrapped as contextual data and never outranks AGENTS.md or higher-priority Codex instructions.

## Contributing And Security

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [docs/privacy-and-security.md](docs/privacy-and-security.md) before filing issues or sending patches that touch memory, hooks, redaction, embeddings, or sync.
