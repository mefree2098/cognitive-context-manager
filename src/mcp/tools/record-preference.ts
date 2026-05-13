import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent } from "./common.js";

export const recordPreferenceSchema = {
  preference: z.string().min(1),
  scope: z.enum(["user", "project", "session"]).default("project"),
  durability: z.enum(["temporary", "long_term"]).default("temporary"),
  source: z.enum(["user", "codex"]).default("codex")
};

export function recordPreference(service: CcmService, input: z.infer<z.ZodObject<typeof recordPreferenceSchema>>) {
  return { memory: service.recordPreference(input) };
}

export function registerRecordPreference(server: any, service: CcmService): void {
  server.tool(
    "record_preference",
    "Record a user, project, or session workflow preference.",
    recordPreferenceSchema,
    async (input: z.infer<z.ZodObject<typeof recordPreferenceSchema>>) => jsonContent(recordPreference(service, input))
  );
}
