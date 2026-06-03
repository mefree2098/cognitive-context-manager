import { homedir } from "node:os";
import { join } from "node:path";
import type { CcmConfig } from "../types/config.js";

export const DEFAULT_CCM_HOME = join(homedir(), ".codex", "cognitive-context-manager");

export const defaultConfig: CcmConfig = {
  enabled: true,
  core: {
    mode: "local",
    fallbackMode: true,
    strictMode: false
  },
  storage: {
    home: DEFAULT_CCM_HOME,
    database: "ccm.sqlite"
  },
  context: {
    softTokenLimit: 1200,
    hardTokenLimit: 2500,
    maxMemories: 5,
    maxOpenLoops: 7,
    includeRawLogs: false,
    includeSuperseded: false
  },
  retrieval: {
    defaultMaxTokens: 3000,
    maxMemories: 12,
    includeStaleWarnings: true,
    searchMode: "fts",
    mode: "hybrid",
    ftsWeight: 0.45,
    vectorWeight: 0.35,
    salienceWeight: 0.1,
    recencyWeight: 0.05,
    openLoopWeight: 0.05,
    excludeSuperseded: true
  },
  memoryBridge: {
    markdown: {
      enabled: true
    },
    nativeTools: {
      enabled: true
    },
    autoTail: {
      enabled: false,
      mode: "disabled",
      maxTokens: 900,
      requireExplicitPreview: true,
      includeOpenLoops: true,
      includeProcedural: true
    }
  },
  embeddings: {
    enabled: true,
    provider: "openai",
    fallbackProvider: "local",
    model: "text-embedding-3-small",
    dimensions: 1536,
    batchSize: 32,
    redactBeforeEmbedding: true,
    storeRawEmbeddingInput: false,
    openai: {
      authMode: "codex",
      apiKeyEnv: "OPENAI_API_KEY",
      codexAuthPath: "~/.codex/auth.json",
      model: "text-embedding-3-small"
    },
    lmstudio: {
      baseUrl: "http://127.0.0.1:1234/v1",
      model: ""
    },
    custom: {
      url: ""
    }
  },
  summarization: {
    enabled: true,
    provider: "deterministic",
    redactBeforeSummarization: true,
    maxInputTokens: 6000,
    maxOutputTokens: 800,
    allowCloud: false,
    openai: {
      apiKeyEnv: "OPENAI_API_KEY",
      model: "gpt-5.5"
    }
  },
  consolidation: {
    enabled: true,
    minSalienceToStore: 0.35,
    promoteToSemanticThreshold: 0.8,
    sessionStopCompaction: true
  },
  daemon: {
    enabled: false,
    intervalSeconds: 30
  },
  sync: {
    enabled: false,
    mode: "none",
    encrypt: true,
    directory: ""
  },
  ui: {
    enabled: false,
    host: "127.0.0.1",
    port: 4388,
    portScanRange: 50
  },
  adaptiveAgents: {
    enabled: true,
    autoUpdateCcmAgents: true,
    autoUpdateProjectAgents: false,
    requireReviewForCcmAgents: false,
    requireReviewForProjectAgents: true,
    maxAgentFileTokens: 1800,
    maxDeltaTokens: 400,
    minConfidenceToWrite: 0.78,
    minRepetitionCount: 2,
    writeCooldownMinutes: 15,
    protectedSections: ["Safety Boundaries", "Instruction Precedence", "Do Not Store"],
    blockedPatterns: ["api[_-]?key", "token", "password", "secret", "credential", "bearer ", "private key"]
  },
  privacy: {
    storeRawPrompts: false,
    storeRawToolOutput: false,
    redactSecrets: true,
    allowCloudEmbeddings: true,
    syncRawLogs: false,
    storeRawEmbeddingInput: false,
    allowTelemetry: false
  },
  retention: {
    enabled: true,
    archiveLowSalienceAfterDays: 30,
    archiveEphemeralAfterDays: 7,
    rawLogRetentionDays: 14,
    keepProjectDecisions: true,
    keepUserPreferences: true,
    requireTombstoneForDelete: true
  },
  personalityRuntime: {
    enabled: true,
    storeStylePreferences: true,
    storeSensitiveAttributes: false
  }
};
