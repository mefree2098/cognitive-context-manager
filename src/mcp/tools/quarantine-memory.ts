import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import { jsonContent } from "./common.js";

export const quarantineMemorySchema = {
  memoryId: z.string().min(1),
  reason: z.string().min(1)
};

export function registerQuarantineMemory(server: any, service: CcmService): void {
  server.tool("quarantine_memory", "Quarantine a suspicious memory so it cannot be injected.", quarantineMemorySchema, async (input: z.infer<z.ZodObject<typeof quarantineMemorySchema>>) =>
    jsonContent({ memory: service.quarantineMemory(input.memoryId, input.reason) })
  );
}
