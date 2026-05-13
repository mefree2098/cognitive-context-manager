import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { CcmConfig } from "../types/config.js";
import { EmbeddingService } from "./embedding-provider.js";
import { HygieneService } from "./hygiene.js";
import { TraceStore } from "./trace-store.js";

export class DaemonService {
  constructor(
    private readonly db: Database.Database,
    private readonly config: CcmConfig
  ) {}

  status() {
    const pidPath = this.pidPath();
    const pid = existsSync(pidPath) ? Number(readFileSync(pidPath, "utf8")) : undefined;
    const running = pid ? isProcessAlive(pid) : false;
    const embeddingQueued = Number((this.db.prepare("SELECT COUNT(*) AS count FROM embedding_jobs WHERE status = 'queued'").get() as { count: number }).count);
    const failedJobs = Number(
      (this.db
        .prepare("SELECT COUNT(*) AS count FROM embedding_jobs WHERE status = 'failed' UNION ALL SELECT COUNT(*) FROM consolidation_jobs WHERE status = 'failed'")
        .get() as { count: number }).count
    );
    return {
      enabled: this.config.daemon.enabled,
      running,
      pid,
      embeddingQueued,
      failedJobs,
      pidPath,
      logsPath: this.logsPath()
    };
  }

  async runOnce(): Promise<{ embeddings: { processed: number; failed: number; provider: string }; hygieneActions: number }> {
    const embeddings = await new EmbeddingService(this.db, this.config).process(100);
    const hygiene = new HygieneService(this.db, this.config).run(false);
    new TraceStore(this.db).record({
      traceType: "daemon",
      title: "daemon run once",
      payload: { embeddings, hygieneActions: hygiene.actions.length }
    });
    return { embeddings, hygieneActions: hygiene.actions.length };
  }

  async start(foreground = false): Promise<{ started: boolean; pid: number; mode: "foreground" | "background" }> {
    mkdirSync(join(this.config.storage.home, "run"), { recursive: true });
    const current = this.status();
    if (current.running && current.pid) return { started: false, pid: current.pid, mode: foreground ? "foreground" : "background" };
    writeFileSync(this.pidPath(), String(process.pid), "utf8");
    if (!foreground) return { started: true, pid: process.pid, mode: "background" };
    while (true) {
      await this.runOnce();
      await new Promise((resolve) => setTimeout(resolve, this.config.daemon.intervalSeconds * 1000));
    }
  }

  stop(): { stopped: boolean; pid?: number } {
    const status = this.status();
    if (status.pid && status.running) {
      try {
        process.kill(status.pid, "SIGTERM");
      } catch {
        // Removing a stale pid file is still useful.
      }
    }
    if (existsSync(this.pidPath())) unlinkSync(this.pidPath());
    return { stopped: Boolean(status.pid), pid: status.pid };
  }

  serviceTemplate(kind: "launchd" | "systemd"): string {
    if (kind === "launchd") {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>com.ccm.daemon</string><key>ProgramArguments</key><array><string>ccm</string><string>daemon</string><string>start</string><string>--foreground</string></array><key>RunAtLoad</key><true/></dict></plist>`;
    }
    return `[Unit]\nDescription=Cognitive Context Manager daemon\n[Service]\nExecStart=ccm daemon start --foreground\nRestart=on-failure\n[Install]\nWantedBy=default.target\n`;
  }

  private pidPath(): string {
    return join(this.config.storage.home, "run", "daemon.pid");
  }

  private logsPath(): string {
    return join(this.config.storage.home, "logs", "ccm.log");
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
