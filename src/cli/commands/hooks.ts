import { setTimeout as sleep } from "node:timers/promises";
import type { Command } from "commander";
import { describePassiveHookProof, hookWatchSnapshot } from "../../core/hook-diagnostics.js";
import { openDb } from "../../storage/db.js";

interface WatchOptions {
  seconds: string;
  intervalMs: string;
  since?: string;
  json?: boolean;
  requireProof?: boolean;
}

export function registerHooksCommand(program: Command): void {
  const hooks = program.command("hooks").description("Diagnose passive Codex hook capture");

  hooks
    .command("watch")
    .description("Watch for host-fired hook launches and passive hook traces")
    .option("--seconds <seconds>", "How long to watch", "600")
    .option("--interval-ms <ms>", "Polling interval", "1000")
    .option("--since <iso>", "Start time for diagnostics; defaults to now")
    .option("--json", "Print final JSON snapshot")
    .option("--require-proof", "Exit nonzero unless host launch and trace are proven")
    .action(async (options: WatchOptions) => {
      const seconds = Math.max(0, Number(options.seconds) || 0);
      const intervalMs = Math.max(100, Number(options.intervalMs) || 1000);
      const startedAt = options.since || new Date().toISOString();
      const context = openDb(process.cwd());
      try {
        const deadline = Date.now() + seconds * 1000;
        let snapshot = hookWatchSnapshot(context.db, context.config.storage.home, startedAt);
        let reportedAttempts = snapshot.realHookAttempts;
        let reportedTraces = snapshot.realHookTraces;

        if (!options.json) {
          console.log(`Watching for Codex-fired hooks since ${startedAt} for ${seconds}s.`);
          console.log(`Attempt log: ${snapshot.attemptLogPath}`);
          console.log("Waiting for host-fired hook...");
        }

        while (Date.now() < deadline && snapshot.passiveHookProof !== "host_launch_and_trace_proven") {
          await sleep(intervalMs);
          snapshot = hookWatchSnapshot(context.db, context.config.storage.home, startedAt);
          if (!options.json && snapshot.realHookAttempts > reportedAttempts) {
            reportedAttempts = snapshot.realHookAttempts;
            console.log(`Real hook attempt seen at ${snapshot.latestRealAttemptAt ?? "unknown"} (${snapshot.latestRealAttemptStage ?? "unknown stage"}).`);
          }
          if (!options.json && snapshot.realHookTraces > reportedTraces) {
            reportedTraces = snapshot.realHookTraces;
            console.log(`Real passive hook trace recorded at ${snapshot.latestRealHookTraceAt ?? "unknown"}.`);
          }
        }

        if (options.json) {
          console.log(JSON.stringify(snapshot, null, 2));
          if (options.requireProof && snapshot.passiveHookProof !== "host_launch_and_trace_proven") process.exitCode = 1;
          return;
        }

        if (snapshot.realHookAttempts === 0 && snapshot.realHookTraces === 0) {
          const selfTestNote = snapshot.selfTestAttempts > 0 ? ` ${snapshot.selfTestAttempts} self-test attempts exist, but they do not prove host firing.` : "";
          console.log(`No host-fired hook observed.${selfTestNote}`);
        }
        console.log(`Passive hook proof: ${snapshot.passiveHookProof} - ${describePassiveHookProof(snapshot.passiveHookProof)}`);
        if (options.requireProof && snapshot.passiveHookProof !== "host_launch_and_trace_proven") process.exitCode = 1;
      } finally {
        context.db.close();
      }
    });
}
