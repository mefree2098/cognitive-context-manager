import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

export const getProjectStateSchema = {
  projectId: optionalString,
  repoPath: optionalString
};

export function getProjectState(service: CcmService, input: z.infer<z.ZodObject<typeof getProjectStateSchema>>) {
  const project = input.projectId
    ? service.projects.get(input.projectId)
    : input.repoPath
      ? service.ensureProjectSession(input.repoPath).project
      : service.projects.listProjects(1)[0];
  return {
    project,
    decisions: service.memories.search({ query: "", projectId: project?.id, memoryTypes: ["semantic"], limit: 12 }),
    procedural: service.memories.search({ query: "", projectId: project?.id, memoryTypes: ["procedural"], limit: 12 }),
    open_loops: service.openLoops.list(project?.id, false, 12),
    warnings: service.conflicts.unresolved(project?.id, 8)
  };
}

export function registerGetProjectState(server: any, service: CcmService): void {
  server.tool(
    "get_project_state",
    "Return known project summary, decisions, conventions, open loops, and warnings.",
    getProjectStateSchema,
    async (input: z.infer<z.ZodObject<typeof getProjectStateSchema>>) => jsonContent(getProjectState(service, input))
  );
}
