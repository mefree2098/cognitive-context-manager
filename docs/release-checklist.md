# Release Checklist

Use this checklist before making a CCM release or changing repository visibility.

## Local Verification

```bash
npm ci
npm run check
npm audit --omit=dev
node dist/cli/ccm.js doctor
npm pack --dry-run
npm run package:local
```

## Fresh Install Verification

From a clean checkout or extracted release bundle:

```bash
./scripts/install-local-plugin.sh
```

Then restart Codex Desktop and verify:

```text
/skills
/mcp
```

Expected:

- `cognitive-context` appears in `/skills`.
- `cognitive-context-manager` appears in `/mcp`.
- `ccm doctor` passes with only expected environment-specific warnings.
- `ccm ui start` opens a localhost dashboard.

## Launch Claims

Safe public claims:

- CCM is local-first and stores its database under `~/.codex/cognitive-context-manager` by default.
- Explicit skill/MCP usage can load compact project context, record decisions, preserve open loops, and create session handoffs.
- The dashboard and `ccm report effectiveness` expose token estimates, execution-continuity signals, memory pressure, and reliability evidence.
- Embeddings use existing Codex auth by default and fall back to deterministic local embeddings when unavailable.

Avoid broad claims unless verified in the user's environment:

- passive hooks are always on
- passive capture is reliable across all Codex Desktop versions
- CCM prevents all context loss
- token savings are exact measurements rather than estimates

For passive-hook claims, require:

```bash
ccm report effectiveness --since 24h --format markdown
```

and confirm `passiveHookProof=host_launch_and_trace_proven`.
