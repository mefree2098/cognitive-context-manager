import { z } from "zod";
import type { CcmService } from "../../core/consolidator.js";
import type { Memory } from "../../types/memory.js";
import { jsonContent, memoryTypeSchema, optionalString } from "./common.js";

const memorySaveSchema = {
  content: z.string().min(1),
  projectId: optionalString,
  memoryType: memoryTypeSchema.default("semantic"),
  summary: optionalString,
  tags: z.array(z.string()).default([]),
  salience: z.number().min(0).max(1).default(0.7),
  confidence: z.number().min(0).max(1).default(0.8)
};

const memorySearchSchema = {
  query: z.string().min(1),
  projectId: optionalString,
  memoryTypes: z.array(memoryTypeSchema).optional(),
  limit: z.number().int().positive().max(50).default(10),
  includeStale: z.boolean().default(false)
};

const memoryListSchema = {
  projectId: optionalString,
  memoryTypes: z.array(memoryTypeSchema).optional(),
  limit: z.number().int().positive().max(50).default(20),
  includeStale: z.boolean().default(false)
};

const memoryUpdateSchema = {
  id: z.string().min(1),
  content: optionalString,
  summary: optionalString,
  memoryType: memoryTypeSchema.optional(),
  tags: z.array(z.string()).optional(),
  salience: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional()
};

const memoryDeleteSchema = {
  id: z.string().min(1),
  hardDelete: z.boolean().default(false)
};

type MemorySaveInput = z.infer<z.ZodObject<typeof memorySaveSchema>>;
type MemorySearchInput = z.infer<z.ZodObject<typeof memorySearchSchema>>;
type MemoryListInput = z.infer<z.ZodObject<typeof memoryListSchema>>;
type MemoryUpdateInput = z.infer<z.ZodObject<typeof memoryUpdateSchema>>;
type MemoryDeleteInput = z.infer<z.ZodObject<typeof memoryDeleteSchema>>;

export function memorySave(service: CcmService, input: MemorySaveInput): { memory: Memory } {
  const projectSession = service.ensureProjectSession(process.cwd());
  const projectId = input.projectId ?? projectSession.project.id;
  const sessionId = input.projectId ? service.projects.latestSession(input.projectId)?.id : projectSession.session.id;
  const memory = service.memories.create({
    projectId,
    sessionId,
    memoryType: input.memoryType,
    eventType: "implementation_step",
    content: input.content,
    summary: input.summary,
    tags: ["native-memory-tool", ...input.tags],
    retrievalCues: [input.summary, ...input.tags].filter((value): value is string => Boolean(value)),
    salience: input.salience,
    confidence: input.confidence,
    sourceRefs: [{ kind: "tool", label: "memory_save", timestamp: new Date().toISOString() }]
  });
  return { memory };
}

export function memorySearch(service: CcmService, input: MemorySearchInput): { results: Memory[] } {
  return { results: service.searchMemories(input) };
}

export function memoryList(service: CcmService, input: MemoryListInput): { results: Memory[] } {
  const results = service
    .searchMemories({
      query: "",
      projectId: input.projectId,
      memoryTypes: input.memoryTypes,
      includeStale: true,
      limit: input.limit
    })
    .filter((memory) => input.includeStale || memory.staleStatus === "active");
  return { results };
}

export function memoryUpdate(
  service: CcmService,
  input: MemoryUpdateInput
): { ok: boolean; memory?: Memory; supersededId?: string; reason?: string } {
  const existing = service.memories.get(input.id);
  if (!existing) return { ok: false, reason: "Memory not found" };

  const content = input.content ?? existing.content;
  const summary = input.summary ?? existing.summary;
  const memoryType = input.memoryType ?? existing.memoryType;
  const tags = input.tags ?? existing.tags;
  const memory = service.memories.create({
    projectId: existing.projectId,
    sessionId: existing.sessionId,
    memoryType,
    eventType: existing.eventType,
    content,
    summary,
    entities: existing.entities,
    tags: ["native-memory-tool", ...tags],
    retrievalCues: existing.retrievalCues,
    salience: input.salience ?? existing.salience,
    confidence: input.confidence ?? existing.confidence,
    sourceRefs: [
      ...existing.sourceRefs,
      { kind: "memory", label: `memory_update:${existing.id}`, timestamp: new Date().toISOString() }
    ],
    supersedes: [existing.id],
    decayPolicy: existing.decayPolicy
  });

  return { ok: true, memory, supersededId: existing.id };
}

export function memoryDelete(service: CcmService, input: MemoryDeleteInput): { ok: boolean; hardDelete: boolean } {
  return { ok: service.memories.forget(input.id, input.hardDelete), hardDelete: input.hardDelete };
}

export function registerNativeMemoryTools(server: any, service: CcmService): void {
  server.tool(
    "memory_save",
    "Save an explicit, atomic memory through CCM's typed/redacted memory store.",
    memorySaveSchema,
    async (input: MemorySaveInput) => jsonContent(memorySave(service, input))
  );
  server.tool(
    "memory_search",
    "Search CCM memories explicitly. Use this instead of relying on hidden auto-injection.",
    memorySearchSchema,
    async (input: MemorySearchInput) => jsonContent(memorySearch(service, input))
  );
  server.tool(
    "memory_list",
    "List recent CCM memories, optionally scoped by project/type/status.",
    memoryListSchema,
    async (input: MemoryListInput) => jsonContent(memoryList(service, input))
  );
  server.tool(
    "memory_update",
    "Update a memory by creating a superseding memory and marking the prior one superseded.",
    memoryUpdateSchema,
    async (input: MemoryUpdateInput) => jsonContent(memoryUpdate(service, input))
  );
  server.tool(
    "memory_delete",
    "Forget a memory through CCM tombstoning by default, with optional hard-delete.",
    memoryDeleteSchema,
    async (input: MemoryDeleteInput) => jsonContent(memoryDelete(service, input))
  );
}
