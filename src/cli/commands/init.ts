import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { defaultConfig } from "../../config/defaults.js";
import { loadConfig } from "../../config/load-config.js";
import { AdaptiveAgentGuidanceService } from "../../core/adaptive-agents.js";
import { openDb } from "../../storage/db.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize CCM config, directories, and SQLite database")
    .action(() => {
      const config = loadConfig(process.cwd());
      mkdirSync(config.storage.home, { recursive: true });
      mkdirSync(join(config.storage.home, "logs"), { recursive: true });
      mkdirSync(join(config.storage.home, "exports"), { recursive: true });
      mkdirSync(join(config.storage.home, "cache"), { recursive: true });
      const configPath = join(config.storage.home, "config.json");
      if (!existsSync(configPath)) {
        writeFileSync(configPath, JSON.stringify({ ...defaultConfig, storage: config.storage }, null, 2), "utf8");
      }
      const context = openDb(process.cwd());
      new AdaptiveAgentGuidanceService(context.db, config).ensureFiles();
      context.db.close();
      console.log(`Initialized Cognitive Context Manager at ${config.storage.home}`);
    });
}
