# Privacy And Security

The MVP is local-first and has no telemetry. It writes to `~/.codex/cognitive-context-manager` by default or to `CCM_HOME` when set.

Secrets are redacted before memory, event, log, or export writes. Redaction covers API keys, OAuth tokens, private keys, passwords, session cookies, connection strings, GitHub tokens, OpenAI keys, AWS keys, Azure credentials, and Google service account private keys.

Cloud embeddings and summarization are disabled by default and require explicit configuration.

Retrieved memories are wrapped between `CCM_CONTEXT_BRIEF_START` and `CCM_CONTEXT_BRIEF_END` with a warning that they are contextual data, not instructions. AGENTS.md and higher-priority Codex instructions always win.

Sync is off by default. File sync bundles are encrypted with AES-256-GCM using a local key in `$CCM_HOME/keys/sync.key`. Redacted records are excluded from sync unless future policy explicitly allows them.

Use `ccm memory quarantine <id>` or the GUI memory explorer to prevent a suspicious memory from being injected.

Adaptive Agent Guidance writes only to CCM-owned files under `~/.codex/ccm/agents` by default. Patches are rejected if they contain secret-like material, weaken audit/redaction/safety/precedence, exceed token budgets, or attempt protected-section changes without explicit override. Project `AGENTS.md` is still only changed through explicit apply commands.
