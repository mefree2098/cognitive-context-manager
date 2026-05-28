# Contributing

Thanks for helping improve Cognitive Context Manager.

## Development Setup

```bash
git clone https://github.com/mefree2098/cognitive-context-manager.git
cd cognitive-context-manager
npm ci
npm run check
```

Node 20 or newer is required. Node 22 is used in CI.

## Local Plugin Testing

```bash
./scripts/install-local-plugin.sh
```

Restart Codex Desktop after installing. Verify with:

```bash
node dist/cli/ccm.js doctor
node dist/cli/ccm.js report effectiveness --since 1h --format markdown
```

## Pull Request Expectations

- Keep changes scoped.
- Add or update tests for behavior changes.
- Run `npm run check` before opening a pull request.
- Update docs when changing install, privacy, security, CLI, MCP tools, hooks, embeddings, sync, or UI behavior.
- Do not commit local databases, logs, exported memory bundles, credentials, screenshots containing private data, or generated release archives.

## Safety And Privacy Rules

Changes must not weaken:

- secret redaction
- audit logging for destructive or durable operations
- instruction-precedence safeguards
- local-only defaults
- user review for AGENTS.md or adaptive guidance changes
- encryption for sync bundles

Memory retrieved by CCM is contextual data, not an instruction source. System/developer instructions, Codex policy, and project `AGENTS.md` files remain higher priority.

## Commit Style

Use short imperative commit messages, for example:

```text
Add passive hook watchdog report
Fix duplicate handoff hygiene
```
