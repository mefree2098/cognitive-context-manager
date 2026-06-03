import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { CcmConfig } from "../types/config.js";
import { defaultConfig } from "./defaults.js";

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function mergeConfig(base: CcmConfig, override: Partial<CcmConfig>): CcmConfig {
  return {
    ...base,
    ...override,
    core: { ...base.core, ...override.core },
    storage: { ...base.storage, ...override.storage },
    context: { ...base.context, ...override.context },
    retrieval: { ...base.retrieval, ...override.retrieval },
    memoryBridge: {
      ...base.memoryBridge,
      ...override.memoryBridge,
      markdown: { ...base.memoryBridge.markdown, ...override.memoryBridge?.markdown },
      nativeTools: { ...base.memoryBridge.nativeTools, ...override.memoryBridge?.nativeTools },
      autoTail: { ...base.memoryBridge.autoTail, ...override.memoryBridge?.autoTail }
    },
    embeddings: {
      ...base.embeddings,
      ...override.embeddings,
      openai: { ...base.embeddings.openai, ...override.embeddings?.openai },
      lmstudio: { ...base.embeddings.lmstudio, ...override.embeddings?.lmstudio },
      custom: { ...base.embeddings.custom, ...override.embeddings?.custom }
    },
    summarization: {
      ...base.summarization,
      ...override.summarization,
      openai: { ...base.summarization.openai, ...override.summarization?.openai }
    },
    consolidation: { ...base.consolidation, ...override.consolidation },
    daemon: { ...base.daemon, ...override.daemon },
    sync: { ...base.sync, ...override.sync },
    ui: { ...base.ui, ...override.ui },
    adaptiveAgents: { ...base.adaptiveAgents, ...override.adaptiveAgents },
    privacy: { ...base.privacy, ...override.privacy },
    retention: { ...base.retention, ...override.retention },
    personalityRuntime: { ...base.personalityRuntime, ...override.personalityRuntime }
  };
}

function readJson(path: string): Partial<CcmConfig> {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CcmConfig> & {
    adaptive_agents?: Record<string, unknown>;
  };
  if (parsed.adaptive_agents && !parsed.adaptiveAgents) {
    const adaptiveAgents: Partial<CcmConfig["adaptiveAgents"]> = {
      enabled: bool(parsed.adaptive_agents.enabled, true),
      autoUpdateCcmAgents: bool(parsed.adaptive_agents.auto_update_ccm_agents, true),
      autoUpdateProjectAgents: bool(parsed.adaptive_agents.auto_update_project_agents, false),
      requireReviewForCcmAgents: bool(parsed.adaptive_agents.require_review_for_ccm_agents, false),
      requireReviewForProjectAgents: bool(parsed.adaptive_agents.require_review_for_project_agents, true),
      maxAgentFileTokens: num(parsed.adaptive_agents.max_agent_file_tokens, 1800),
      maxDeltaTokens: num(parsed.adaptive_agents.max_delta_tokens, 400),
      minConfidenceToWrite: num(parsed.adaptive_agents.min_confidence_to_write, 0.78),
      minRepetitionCount: num(parsed.adaptive_agents.min_repetition_count, 2),
      writeCooldownMinutes: num(parsed.adaptive_agents.write_cooldown_minutes, 15)
    };
    const protectedSections = strArray(parsed.adaptive_agents.protected_sections);
    const blockedPatterns = strArray(parsed.adaptive_agents.blocked_patterns);
    if (protectedSections) adaptiveAgents.protectedSections = protectedSections;
    if (blockedPatterns) adaptiveAgents.blockedPatterns = blockedPatterns;
    parsed.adaptiveAgents = adaptiveAgents as CcmConfig["adaptiveAgents"];
  }
  return parsed;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function strArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

export function loadConfig(repoPath = process.cwd()): CcmConfig {
  const envHome = process.env.CCM_HOME;
  const userPath = join(expandHome(envHome ?? defaultConfig.storage.home), "config.json");
  const projectPath = join(repoPath, ".codex", "ccm.config.json");

  const envOverride: Partial<CcmConfig> = envHome
    ? { storage: { ...defaultConfig.storage, home: expandHome(envHome) } }
    : {};

  let config = mergeConfig(defaultConfig, envOverride);
  config = mergeConfig(config, readJson(userPath));
  config = mergeConfig(config, readJson(projectPath));
  config = mergeConfig(config, envOverride);

  config.storage.home = expandHome(config.storage.home);
  if (!isAbsolute(config.storage.home)) {
    config.storage.home = resolve(repoPath, config.storage.home);
  }

  return config;
}

export function getDatabasePath(config: CcmConfig): string {
  return join(config.storage.home, config.storage.database);
}

export function getUserConfigPath(): string {
  const envHome = process.env.CCM_HOME;
  return join(expandHome(envHome ?? defaultConfig.storage.home), "config.json");
}
