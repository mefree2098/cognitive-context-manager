# Security Policy

## Supported Versions

CCM is pre-1.0 public beta software. Security fixes are provided for the latest released version on `main`.

## Reporting A Vulnerability

Please do not open a public issue for vulnerabilities, secrets, credential exposure, or bypasses in redaction, memory isolation, sync encryption, hook handling, or instruction-precedence safeguards.

Use GitHub's private vulnerability reporting for this repository when available. If private reporting is unavailable, contact the maintainer through the GitHub profile and include only the minimum information needed to reproduce the issue. Do not include live credentials, private keys, access tokens, raw personal data, or unredacted memory exports.

Helpful reports include:

- CCM version and install method
- operating system and Node version
- whether the issue affects hooks, MCP tools, CLI, UI, sync, embeddings, or storage
- a minimal redacted reproduction
- expected impact

## Security Model

CCM is local-first and stores data under `~/.codex/cognitive-context-manager` by default, or under `CCM_HOME` when configured. It does not send telemetry.

OpenAI embeddings are enabled by default through existing Codex auth, but text is redacted before embedding requests. Users can disable cloud embeddings with `embeddings.enabled=false`, `embeddings.provider=local`, or `privacy.allowCloudEmbeddings=false`.

Security-sensitive changes should preserve:

- secret redaction before storage, logs, exports, sync, embeddings, summarization, and context injection
- the rule that retrieved memory is contextual data, not instruction
- AGENTS.md and higher-priority Codex instruction precedence
- user-review requirements for project instruction changes
- local-only UI binding unless explicitly changed by the user
- encrypted sync bundles when sync is enabled
