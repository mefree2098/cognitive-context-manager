import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent, optionalString } from "./common.js";

export const recordOpenLoopSchema = {
  title: z.string().min(1),
  description: z.string().min(1),
  projectId: optionalString,
  priority: z.number().int().min(1).max(5).default(3)
};

export const resolveOpenLoopSchema = {
  id: z.string().min(1),
  resolution: optionalString
};

export function registerOpenLoopTools(server: any, service: CcmService): void {
  server.tool("record_open_loop", "Record an unresolved task, blocker, or question.", recordOpenLoopSchema, async (input: z.infer<z.ZodObject<typeof recordOpenLoopSchema>>) => jsonContent({ open_loop: service.recordOpenLoop(input) }));
  server.tool("resolve_open_loop", "Resolve an open-loop task.", resolveOpenLoopSchema, async (input: z.infer<z.ZodObject<typeof resolveOpenLoopSchema>>) => jsonContent({ open_loop: service.resolveOpenLoop(input) }));
}
