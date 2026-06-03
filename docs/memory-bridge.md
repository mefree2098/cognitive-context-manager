# Memory Bridge

CCM can borrow Headroom's best memory-manager ergonomics while keeping CCM's memory safety model: typed records, project scoping, redaction, staleness, quarantine, and explicit context briefs.

## Implemented

### Markdown Bridge

Export active memories to a round-trippable Markdown file:

```bash
ccm memory-bridge export --project <projectId> --out ccm-memories.md
```

Import CCM Markdown exports or generic sectioned Markdown:

```bash
ccm memory-bridge import ccm-memories.md --project <projectId>
ccm memory-bridge import notes.md --type procedural --tag migration
ccm memory-bridge import notes.md --dry-run
```

CCM-formatted exports include `<!-- ccm-memory ... -->` metadata so memory type, tags, salience, confidence, and stale status can round-trip. Generic Markdown is chunked by headings and imported as typed memories using the requested default type.

### Explicit Native-Style Memory Tools

The MCP server exposes Headroom-compatible explicit memory tool names:

- `memory_save`
- `memory_search`
- `memory_list`
- `memory_update`
- `memory_delete`

These tools are aliases into CCM semantics. `memory_update` creates a superseding memory and marks the previous memory superseded rather than mutating history in place. `memory_delete` tombstones by default unless `hardDelete` is explicitly set.

### Policy-Gated Auto-Tail Preview

CCM can render the exact block a runtime adapter would append to the latest user message:

```bash
ccm context auto-tail --query "current task" --force-preview
ccm context auto-tail --query "current task" --json
```

The MCP server exposes the same behavior as `preview_auto_tail_context`. This preview path never performs runtime injection; it reports `runtimeInjectionPerformed: false` and returns policy fields such as `policyWouldAllowInjection`, `reason`, `memoryIds`, and `tokenEstimate`.

The `UserPromptSubmit` hook also includes a runtime adapter. It emits:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "CCM_AUTO_TAIL_CONTEXT_START..."
  }
}
```

That output is produced only when policy allows injection. By default, policy does not allow it.

Auto-tail is disabled by default:

```json
{
  "memoryBridge": {
    "autoTail": {
      "enabled": false,
      "mode": "disabled",
      "maxTokens": 900,
      "requireExplicitPreview": true,
      "includeOpenLoops": true,
      "includeProcedural": true
    }
  }
}
```

For trial use, set `mode` to `preview`. Runtime adapters should only act when `enabled` is true, `mode` is `inject`, and policy either does not require preview acceptance or receives an explicit accepted-preview signal.

For hook-side injection experiments:

```json
{
  "memoryBridge": {
    "autoTail": {
      "enabled": true,
      "mode": "inject",
      "requireExplicitPreview": true
    }
  }
}
```

With `requireExplicitPreview: true`, the hook adapter requires `ccmAutoTailAcceptedPreview: true`, `ccm_auto_tail_accepted_preview: true`, or `CCM_AUTO_TAIL_ACCEPTED_PREVIEW=true`. Set `requireExplicitPreview` to false only when you intentionally want automatic hook-side additional context.

## Policy For Remaining Headroom-Style Features

### Provider-Native Memory Adapters

Provider-native memory should be treated as an adapter layer over CCM, not a separate source of truth. The safe version should:

- Keep CCM's SQLite store authoritative.
- Translate provider-native save/search calls into typed CCM memory operations.
- Preserve source refs showing which provider/tool requested the memory action.
- Avoid writing provider memories directly when CCM redaction or quarantine would block them.

### Bridge Import Formats

Future importers can target Headroom JSON exports, Obsidian-style vaults, or AGENTS-like markdown, but every importer should run through the same CCM write path so redaction, project attribution, and staleness remain consistent.
