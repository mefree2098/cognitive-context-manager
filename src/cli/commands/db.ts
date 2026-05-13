import type { Command } from "commander";
import { backupDatabase, migrate, repairDatabase, rollbackDatabase, schemaStatus, verifyDatabase } from "../../core/db-admin.js";
import { openDb } from "../../storage/db.js";

export function registerDbCommand(program: Command): void {
  const db = program.command("db").description("Database migration, backup, verification, and repair commands");

  db.command("status").action(() => withDb((context) => console.log(JSON.stringify(schemaStatus(context.db), null, 2))));
  db.command("migrate").action(() => withDb((context) => console.log(JSON.stringify(migrate(context.db), null, 2))));
  db.command("backup").action(() => console.log(JSON.stringify({ path: backupDatabase(process.cwd()) }, null, 2)));
  db.command("verify").action(() => withDb((context) => console.log(JSON.stringify(verifyDatabase(context.db), null, 2))));
  db.command("repair").action(() => withDb((context) => console.log(JSON.stringify({ actions: repairDatabase(context.db) }, null, 2))));
  db.command("rollback").requiredOption("--to <versionOrBackup>", "Backup filename/path or version marker").action((options: { to: string }) => {
    console.log(JSON.stringify({ message: rollbackDatabase(options.to, process.cwd()) }, null, 2));
  });
}

function withDb(fn: (context: ReturnType<typeof openDb>) => void): void {
  const context = openDb(process.cwd());
  try {
    fn(context);
  } finally {
    context.db.close();
  }
}
