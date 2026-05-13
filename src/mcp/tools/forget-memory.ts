import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent } from "./common.js";

export const forgetMemorySchema = {
  memoryId: z.string().min(1),
  hardDelete: z.boolean().default(false)
};

export function forgetMemory(service: CcmService, input: z.infer<z.ZodObject<typeof forgetMemorySchema>>) {
  return { ok: service.memories.forget(input.memoryId, input.hardDelete) };
}

export function registerForgetMemory(server: any, service: CcmService): void {
  server.tool(
    "forget_memory",
    "Tombstone a memory by default, or hard-delete if explicitly requested.",
    forgetMemorySchema,
    async (input: z.infer<z.ZodObject<typeof forgetMemorySchema>>) => jsonContent(forgetMemory(service, input))
  );
}
