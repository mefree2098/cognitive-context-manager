import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CcmConfig } from "../types/config.js";

export type OpenAiCredentialSource = "codex-chatgpt" | "codex-api-key" | "env" | "none";

export interface ResolvedOpenAiCredential {
  token?: string;
  source: OpenAiCredentialSource;
  expiresAt?: string;
  unavailableReason?: string;
}

type OpenAiConfig = CcmConfig["embeddings"]["openai"];

export function resolveOpenAiCredential(config: OpenAiConfig): ResolvedOpenAiCredential {
  const mode = config.authMode ?? "codex";
  const codex = mode === "codex" || mode === "auto" ? resolveCodexCredential(config.codexAuthPath) : undefined;
  if (codex?.token) return codex;

  const env = mode === "env" || mode === "auto" ? resolveEnvCredential(config.apiKeyEnv) : undefined;
  if (env?.token) return env;

  return {
    source: "none",
    unavailableReason: codex?.unavailableReason ?? env?.unavailableReason ?? "No OpenAI credential was available."
  };
}

function resolveCodexCredential(path: string): ResolvedOpenAiCredential {
  const authPath = expandHome(path || "~/.codex/auth.json");
  if (!existsSync(authPath)) {
    return { source: "none", unavailableReason: `Codex auth file not found at ${authPath}.` };
  }

  let auth: unknown;
  try {
    auth = JSON.parse(readFileSync(authPath, "utf8"));
  } catch {
    return { source: "none", unavailableReason: `Codex auth file could not be parsed at ${authPath}.` };
  }

  const accessToken = getString(auth, ["tokens", "access_token"]);
  if (accessToken) {
    const expiry = jwtExpiry(accessToken);
    if (!expiry || expiry.getTime() > Date.now() + 60_000) {
      return { token: accessToken, source: "codex-chatgpt", expiresAt: expiry?.toISOString() };
    }
    return { source: "none", unavailableReason: `Codex ChatGPT access token expired at ${expiry.toISOString()}.` };
  }

  const apiKey = getString(auth, ["OPENAI_API_KEY"]);
  if (apiKey) return { token: apiKey, source: "codex-api-key" };

  return { source: "none", unavailableReason: "Codex auth exists but contains no usable ChatGPT access token or API key." };
}

function resolveEnvCredential(envName: string): ResolvedOpenAiCredential {
  const token = envName ? process.env[envName] : undefined;
  return token
    ? { token, source: "env" }
    : { source: "none", unavailableReason: `Environment variable ${envName || "OPENAI_API_KEY"} is not set.` };
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function getString(input: unknown, path: string[]): string | undefined {
  let current = input;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.length > 0 ? current : undefined;
}

function jwtExpiry(token: string): Date | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof decoded.exp === "number" ? new Date(decoded.exp * 1000) : undefined;
  } catch {
    return undefined;
  }
}
