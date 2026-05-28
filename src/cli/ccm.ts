#!/usr/bin/env node
import { Command } from "commander";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerAgentsCommand } from "./commands/agents.js";
import { registerBenchCommand } from "./commands/bench.js";
import { registerContextCommand } from "./commands/context.js";
import { registerConflictsCommand } from "./commands/conflicts.js";
import { registerDaemonCommand } from "./commands/daemon.js";
import { registerDbCommand } from "./commands/db.js";
import { registerEmbeddingsCommand } from "./commands/embeddings.js";
import { registerExportCommand } from "./commands/export.js";
import { registerHygieneCommand } from "./commands/hygiene.js";
import { registerHooksCommand } from "./commands/hooks.js";
import { registerImportCommand } from "./commands/import.js";
import { registerInitCommand } from "./commands/init.js";
import { registerKeysCommand } from "./commands/keys.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { registerProjectCommand } from "./commands/project.js";
import { registerReportCommand } from "./commands/report.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerTraceCommand } from "./commands/trace.js";
import { registerUiCommand } from "./commands/ui.js";
import { isMainModule } from "../runtime/is-main.js";

export function buildCli(): Command {
  const program = new Command();
  program.name("ccm").description("Cognitive Context Manager for Codex").version("0.3.3");

  registerInitCommand(program);
  registerDoctorCommand(program);
  registerStatusCommand(program);
  registerDbCommand(program);
  registerMemoryCommand(program);
  registerProjectCommand(program);
  registerReportCommand(program);
  registerTraceCommand(program);
  registerContextCommand(program);
  registerConflictsCommand(program);
  registerEmbeddingsCommand(program);
  registerDaemonCommand(program);
  registerSyncCommand(program);
  registerKeysCommand(program);
  registerUiCommand(program);
  registerAgentsCommand(program);
  registerHygieneCommand(program);
  registerHooksCommand(program);
  registerBenchCommand(program);
  registerExportCommand(program);
  registerImportCommand(program);

  return program;
}

if (isMainModule(import.meta.url)) {
  buildCli().parse(process.argv);
}
