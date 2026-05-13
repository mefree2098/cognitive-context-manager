import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

export const reconcileConflictsSchema = {
  projectId: optionalString
};

export function registerReconcileConflicts(server: any, service: CcmService): void {
  server.tool("reconcile_conflicts", "Find contradictory active memories and suggest resolutions.", reconcileConflictsSchema, async (input: z.infer<z.ZodObject<typeof reconcileConflictsSchema>>) =>
    jsonContent(service.reconcileConflicts(input.projectId))
  );
}
