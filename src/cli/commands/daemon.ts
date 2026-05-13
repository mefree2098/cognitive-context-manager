import type { Command } from "commander";
import { spawn } from "node:child_process";
import { loadConfig } from "../../config/load-config.js";
import { DaemonService } from "../../core/daemon-service.js";
import { openDb } from "../../storage/db.js";

export function registerDaemonCommand(program: Command): void {
  const daemon = program.command("daemon").description("Optional background consolidation daemon");
  daemon.command("status").action(() => withDaemon((service) => console.log(JSON.stringify(service.status(), null, 2))));
  daemon.command("start").option("--foreground", "Run in foreground loop").action(async (options: { foreground?: boolean }) => {
    if (!options.foreground) {
      const child = spawn(process.execPath, [process.argv[1], "daemon", "start", "--foreground"], {
        detached: true,
        stdio: "ignore",
        cwd: process.cwd(),
        env: process.env
      });
      child.unref();
      console.log(JSON.stringify({ started: true, pid: child.pid, mode: "background" }, null, 2));
      return;
    }
    await withDaemonAsync((service) => service.start(true));
  });
  daemon.command("restart").action(async () => withDaemonAsync(async (service) => {
    service.stop();
    return service.start(false);
  }));
  daemon.command("stop").action(() => withDaemon((service) => console.log(JSON.stringify(service.stop(), null, 2))));
  daemon.command("logs").action(() => withDaemon((service) => console.log(service.status().logsPath)));
  daemon.command("install-service").action(() => withDaemon((service) => console.log(service.serviceTemplate(process.platform === "darwin" ? "launchd" : "systemd"))));
  daemon.command("uninstall-service").action(() => console.log("Remove the launchd/systemd service file installed from the template, then run ccm daemon stop."));
}

function withDaemon(fn: (service: DaemonService) => void): void {
  const context = openDb(process.cwd());
  try {
    fn(new DaemonService(context.db, loadConfig(process.cwd())));
  } finally {
    context.db.close();
  }
}

async function withDaemonAsync(fn: (service: DaemonService) => Promise<unknown>): Promise<void> {
  const context = openDb(process.cwd());
  try {
    console.log(JSON.stringify(await fn(new DaemonService(context.db, loadConfig(process.cwd()))), null, 2));
  } finally {
    context.db.close();
  }
}
