import type { Command } from "commander";
import { CcmService } from "../../core/consolidator.js";
import { openDb } from "../../storage/db.js";

export function registerProjectCommand(program: Command): void {
  const project = program.command("project").description("Project context commands");

  project.command("show").option("--json", "Print JSON").action((options: { json?: boolean }) => {
    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db, repoPath: process.cwd() });
      const detected = service.ensureProjectSession(process.cwd()).project;
      if (options.json) console.log(JSON.stringify(detected, null, 2));
      else console.log(`${detected.name}\n${detected.rootPath ?? ""}\n${detected.id}`);
    } finally {
      context.db.close();
    }
  });

  project.command("refresh").action(() => {
    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db, repoPath: process.cwd() });
      console.log(JSON.stringify(service.ensureProjectSession(process.cwd()).project, null, 2));
    } finally {
      context.db.close();
    }
  });

  project.command("state").action(() => {
    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db, repoPath: process.cwd() });
      const project = service.ensureProjectSession(process.cwd()).project;
      console.log(JSON.stringify({
        project,
        decisions: service.memories.search({ query: "", projectId: project.id, memoryTypes: ["semantic"], limit: 20 }),
        constraints: service.memories.search({ query: "", projectId: project.id, memoryTypes: ["procedural"], limit: 20 }),
        artifacts: service.artifacts.list(project.id, 30)
      }, null, 2));
    } finally {
      context.db.close();
    }
  });

  project.command("open-loops").action(() => {
    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db, repoPath: process.cwd() });
      const project = service.ensureProjectSession(process.cwd()).project;
      console.log(JSON.stringify(service.openLoops.list(project.id, false, 50), null, 2));
    } finally {
      context.db.close();
    }
  });

  project.command("summary").option("--json", "Print JSON").action((options: { json?: boolean }) => {
    const context = openDb(process.cwd());
    try {
      const service = new CcmService({ db: context.db, repoPath: process.cwd() });
      const { project: detected } = service.ensureProjectSession(process.cwd());
      const response = service.getWorkingContext({ task: "Summarize current project state", repoPath: process.cwd(), maxTokens: 2200 });
      if (options.json) console.log(JSON.stringify({ project: detected, context: response }, null, 2));
      else console.log(response.working_context_brief);
    } finally {
      context.db.close();
    }
  });
}
