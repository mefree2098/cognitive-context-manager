# Passive Hook Test

Use this recipe when you need proof that Codex Desktop is firing CCM hooks without an explicit MCP call.

## Prep

From the plugin repo:

```bash
npm run build
npm run install:local
node dist/cli/ccm.js doctor --installed-hook-self-test
```

Expected prep result:

- `Installed hook entrypoint self-test` passes.
- `Hook cache fingerprints` shows source/cache matches.
- `Hook attempt fallback log` may say `self-test only`; that is not passive proof.

Quit and reopen Codex Desktop after install. Confirm the Cognitive Context Manager plugin and skill are enabled.

## Watch

In Terminal, start the watcher from the plugin repo:

```bash
node dist/cli/ccm.js hooks watch --seconds 600
```

For CI-style proof, make the watcher fail unless both a host launch and a trace are observed:

```bash
node dist/cli/ccm.js hooks watch --seconds 600 --require-proof
```

Leave it running. It watches two things from the current timestamp forward:

- `hook-attempts.jsonl`, which proves the hook entrypoint was launched.
- real passive hook traces in the CCM SQLite database.

## Trigger

Open a brand-new Codex chat in any workspace and run a normal non-trivial prompt, for example:

```text
Please inspect this repo, summarize the current project structure, and do not edit files.
```

Do not explicitly mention CCM in that prompt. The goal is passive behavior.

## Interpret

The watcher prints one of these proof states:

- `not_proven`: no host-fired hook launch or real hook trace was observed.
- `self_test_only`: only CCM doctor/self-tests launched the hook.
- `host_launch_seen`: Codex launched the hook, but CCM did not record a passive hook trace.
- `host_launch_and_trace_proven`: Codex launched the hook and CCM recorded the passive hook trace.

For publishing claims, require `host_launch_and_trace_proven` after a fresh Codex Desktop restart.

## Report

After the watch run:

```bash
node dist/cli/ccm.js report effectiveness --since 1h --format markdown
```

Look for:

- `Passive hook proof: host_launch_and_trace_proven`
- `Passive hook status: recent`
- nonzero passive hook events
- no hook failures

If the watcher says `host_launch_seen`, the host fired the hook but CCM failed after launch. Check `$CCM_HOME/logs/ccm.log` and `$CCM_HOME/logs/hook-attempts.jsonl`.

If the watcher says `self_test_only` or `not_proven`, the cached hook entrypoint works but Codex Desktop did not fire it during the test window.
