# Colleague Trial Handoff

This is the fastest way to let another Codex Desktop user trial Cognitive Context Manager as a local plugin.

## Option A: Install From GitHub

Use this when the colleague has access to the repo:

```bash
git clone https://github.com/mefree2098/cognitive-context-manager.git
cd cognitive-context-manager
./scripts/install-local-plugin.sh
```

If the repository is private, add the colleague as a collaborator first or use the tarball option below.

## Option B: Install From A Tarball

On the maintainer machine:

```bash
cd /Users/matt/Documents/contextplugin/cognitive-context-manager
npm run package:local
```

Send these two files from `release/`:

```text
cognitive-context-manager-<version>-local.tar.gz
cognitive-context-manager-<version>-local.tar.gz.sha256
```

On the colleague machine:

```bash
shasum -a 256 -c cognitive-context-manager-<version>-local.tar.gz.sha256
tar -xzf cognitive-context-manager-<version>-local.tar.gz
cd cognitive-context-manager
./scripts/install-local-plugin.sh
```

## What The Installer Changes

The installer is local-only. It does not configure any cloud telemetry.

- Installs the plugin under `~/.codex/local-marketplaces/ccm/plugins/cognitive-context-manager`
- Writes a Codex local marketplace at `~/.codex/local-marketplaces/ccm/.agents/plugins/marketplace.json`
- Updates `~/.codex/config.toml` with `hooks = true`, `memories = true`, the Local marketplace, and the enabled plugin
- Builds the plugin and prunes dev dependencies
- Initializes CCM storage at `~/.codex/cognitive-context-manager/ccm.sqlite`
- Runs `ccm doctor`

## Codex Desktop Steps

After install:

1. Quit and reopen Codex Desktop.
2. Open Plugins.
3. Select the Local marketplace if it is not already selected.
4. Enable Cognitive Context Manager if it is not already enabled.
5. Open a chat and run `/skills`.
6. Open a chat and run `/mcp`.

Expected results:

- `/skills` shows `cognitive-context`.
- `/mcp` shows `cognitive-context-manager`.
- New non-trivial workspace tasks can use CCM automatically through the skill guidance.

## Trial Prompt

For a meaningful trial, start a long-ish Codex task with:

```text
Use Cognitive Context Manager for this task.

Before planning or editing, call get_working_context with this repo path and project name.
Record durable decisions, failures, recoveries, checkpoints, and open loops in CCM.
Before stopping, check open loops and compact the session.
```

## Effectiveness Reporting

After the colleague has used it for a few tasks:

```bash
cd ~/.codex/local-marketplaces/ccm/plugins/cognitive-context-manager
node dist/cli/ccm.js report effectiveness --since 7d --format markdown
```

Useful signals:

- `captureMode` shows whether CCM is seeing explicit MCP use, passive hooks, or both.
- `contextDividend` estimates how much live context was avoided by retrieving compact memory.
- checkpoint, failure, and recovery counts show whether long-running work is becoming more resumable.
- open-loop and decision counts show whether important state is preserved across compaction.

## Troubleshooting

If the plugin does not appear:

```bash
cat ~/.codex/config.toml
cat ~/.codex/local-marketplaces/ccm/.agents/plugins/marketplace.json
```

Confirm `source = "/Users/<you>/.codex/local-marketplaces/ccm"` under `[marketplaces.local]`, then fully restart Codex Desktop.

If `/skills` works but passive hook reporting is empty:

```bash
cd ~/.codex/local-marketplaces/ccm/plugins/cognitive-context-manager
node dist/cli/ccm.js doctor
ls hooks.json hooks/hooks.json
```

Confirm `~/.codex/config.toml` has `[features].hooks = true`, not only `codex_hooks = true`, then restart Codex Desktop.

If install fails on `better-sqlite3`, install or update Xcode Command Line Tools and rerun:

```bash
xcode-select --install
./scripts/install-local-plugin.sh
```
