export interface CcmConfig {
  enabled: boolean;
  core: {
    mode: "local";
    fallbackMode: boolean;
    strictMode: boolean;
  };
  storage: {
    home: string;
    database: string;
  };
  context: {
    softTokenLimit: number;
    hardTokenLimit: number;
    maxMemories: number;
    maxOpenLoops: number;
    includeRawLogs: boolean;
    includeSuperseded: boolean;
  };
  retrieval: {
    defaultMaxTokens: number;
    maxMemories: number;
    includeStaleWarnings: boolean;
    searchMode: "fts" | "like";
    mode: "fts" | "vector" | "hybrid";
    ftsWeight: number;
    vectorWeight: number;
    salienceWeight: number;
    recencyWeight: number;
    openLoopWeight: number;
    excludeSuperseded: boolean;
  };
  memoryBridge: {
    markdown: {
      enabled: boolean;
    };
    nativeTools: {
      enabled: boolean;
    };
    autoTail: {
      enabled: boolean;
      mode: "disabled" | "preview" | "inject";
      maxTokens: number;
      requireExplicitPreview: boolean;
      includeOpenLoops: boolean;
      includeProcedural: boolean;
    };
  };
  embeddings: {
    enabled: boolean;
    provider: "none" | "local" | "lmstudio" | "openai" | "custom";
    fallbackProvider: "none" | "local";
    model: string;
    dimensions: number;
    batchSize: number;
    redactBeforeEmbedding: boolean;
    storeRawEmbeddingInput: boolean;
    openai: {
      authMode: "codex" | "env" | "auto";
      apiKeyEnv: string;
      codexAuthPath: string;
      model: string;
    };
    lmstudio: {
      baseUrl: string;
      model: string;
    };
    custom: {
      url: string;
      apiKeyEnv?: string;
      model?: string;
      dimensions?: number;
    };
  };
  summarization: {
    enabled: boolean;
    provider: "deterministic" | "local" | "lmstudio" | "openai" | "custom";
    redactBeforeSummarization: boolean;
    maxInputTokens: number;
    maxOutputTokens: number;
    allowCloud: boolean;
    openai: {
      apiKeyEnv: string;
      model: string;
    };
    endpoint?: string;
  };
  consolidation: {
    enabled: boolean;
    minSalienceToStore: number;
    promoteToSemanticThreshold: number;
    sessionStopCompaction: boolean;
  };
  daemon: {
    enabled: boolean;
    intervalSeconds: number;
  };
  sync: {
    enabled: boolean;
    mode: "none" | "file" | "ssh" | "http" | "sqlite-export";
    encrypt: boolean;
    directory: string;
  };
  ui: {
    enabled: boolean;
    host: string;
    port: number;
    portScanRange: number;
  };
  adaptiveAgents: {
    enabled: boolean;
    autoUpdateCcmAgents: boolean;
    autoUpdateProjectAgents: boolean;
    requireReviewForCcmAgents: boolean;
    requireReviewForProjectAgents: boolean;
    maxAgentFileTokens: number;
    maxDeltaTokens: number;
    minConfidenceToWrite: number;
    minRepetitionCount: number;
    writeCooldownMinutes: number;
    protectedSections: string[];
    blockedPatterns: string[];
  };
  privacy: {
    storeRawPrompts: boolean;
    storeRawToolOutput: boolean;
    redactSecrets: boolean;
    allowCloudEmbeddings: boolean;
    syncRawLogs: boolean;
    storeRawEmbeddingInput: boolean;
    allowTelemetry: boolean;
  };
  retention: {
    enabled: boolean;
    archiveLowSalienceAfterDays: number;
    archiveEphemeralAfterDays: number;
    rawLogRetentionDays: number;
    keepProjectDecisions: boolean;
    keepUserPreferences: boolean;
    requireTombstoneForDelete: boolean;
  };
  personalityRuntime: {
    enabled: boolean;
    storeStylePreferences: boolean;
    storeSensitiveAttributes: boolean;
  };
}
