import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { CcmService } from "../../core/consolidator.js";
import { openDb } from "../../storage/db.js";
import type { Memory } from "../../types/memory.js";

export function registerImportCommand(program: Command): void {
  program
    .command("import")
    .description("Import memories from a CCM export JSON file")
    .argument("<path>")
    .action((path: string) => {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { memories?: Memory[] };
      const context = openDb(process.cwd());
      try {
        const service = new CcmService({ db: context.db, repoPath: process.cwd() });
        let imported = 0;
        for (const memory of parsed.memories ?? []) {
          if (service.memories.get(memory.id)) continue;
          service.memories.create(memory);
          imported += 1;
        }
        console.log(JSON.stringify({ imported }, null, 2));
      } finally {
        context.db.close();
      }
    });
}
