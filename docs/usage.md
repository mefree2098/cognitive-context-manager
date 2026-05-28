# Usage

Before substantial work, call `get_working_context` with the task and repo path.

During work, record decisions with `record_decision`, inspect open loops with `get_open_loops`, and use `search_memories` for prior context references.

At the end of meaningful work, call `compact_session` so the next session can resume from a concise handoff.

Do not paste raw memory dumps into user-facing answers. Use the brief to stay grounded and concise.

## Hardening And Inspection

```bash
ccm db status
ccm db backup
ccm db verify
ccm trace explain --latest
ccm context dividend
ccm report effectiveness --since 7d --format markdown
```

`ccm report effectiveness` is a local-only usefulness report for deciding whether CCM is actually helping. It combines context-brief activations, stored memories, open-loop preservation, token-savings estimates, hook/MCP reliability, memory pressure, and long-running task resilience signals such as resume/checkpoint/failure/recovery language. For checkpoint-heavy work such as manga generation, run:

```bash
ccm report effectiveness --since all --project-name manga --format markdown
```

Read the report conservatively:

- `passiveHookStatus=recent` means passive hooks fired within the current freshness window.
- `passiveHookProof=host_launch_and_trace_proven` is the current bar for claiming CCM works as a silent always-on safety net.
- `passiveHookStatus=stale` means hooks have fired before, but CCM is not currently proven as a silent always-on safety net.
- `captureMode=explicit_mcp_only` is still useful, but it means value is coming from explicit skill/MCP use.
- `memoryPressure=high` or `critical` means active memories may need hygiene/consolidation before making publishing claims.
- Token savings are estimates; use them alongside checkpoint/resume and recovery evidence.

## Attribution And Context Hygiene

CCM can repair cross-project open loops when a task was captured under the wrong current working directory:

```bash
ccm hygiene attribution
ccm hygiene attribution --apply
```

Duplicate and handoff hygiene archives repeated compact-session summaries while keeping the newest handoffs active:

```bash
ccm hygiene duplicates --keep-recent-handoffs 5
ccm hygiene duplicates --apply --keep-recent-handoffs 5
```

CCM also maintains one active rolling project-state memory per project with the current goal, last verified state, active blockers, next action, and recent decisions. Outcome events such as `tests_passed`, `build_passed`, `deployed`, `qa_verified`, `blocked`, and `abandoned` appear in effectiveness reports.

## Embeddings

Embeddings are enabled by default. CCM first uses the existing Codex auth file at `~/.codex/auth.json` for OpenAI embeddings, redacts text before embedding requests, and falls back to deterministic local embeddings if Codex auth is unavailable.

Check the active provider:

```bash
ccm embeddings status
```

To force deterministic local embeddings, set:

```json
{
  "embeddings": { "enabled": true, "provider": "local" },
  "retrieval": { "mode": "hybrid" }
}
```

Then run:

```bash
ccm embeddings backfill
ccm embeddings process
```

To opt out and return to FTS-only retrieval:

```bash
ccm embeddings disable
```

## Optional Daemon

```bash
ccm daemon status
ccm daemon start
ccm daemon stop
```

The daemon processes queues. Codex hooks and MCP tools continue working when it is disabled.

## Optional GUI

```bash
ccm ui start
```

The dashboard binds to `127.0.0.1:4388` by default and exposes overview, memory search, and context preview APIs.

## Optional Encrypted File Sync

```bash
ccm sync init
ccm sync push
ccm sync pull --path <bundle>
```

Sync is off by default and uses encrypted local bundles.

## AGENTS.md Suggestions

```bash
ccm agents suggest --reason "Repeated correction" --instruction "Always verify current files before trusting memory."
ccm agents suggestions
ccm agents show <id>
ccm agents apply <id>
```

CCM never edits AGENTS.md unless the user explicitly applies a suggestion.

## Adaptive Agent Guidance

```bash
ccm agents adaptive status
ccm agents adaptive preview
ccm agents adaptive propose --text "Going forward, keep CCM context compact and do not inject raw logs."
ccm agents adaptive diff
ccm agents adaptive apply
ccm agents adaptive history
ccm agents adaptive explain "raw logs"
ccm agents adaptive rollback --to last
```

CCM may update its own managed `CCM_AGENTS.md` automatically when durable behavior guidance is repeated or explicit and passes safety checks. It does not silently modify project `AGENTS.md`.
