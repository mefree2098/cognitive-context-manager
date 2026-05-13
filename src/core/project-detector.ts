import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { ProjectSummary } from "../types/project.js";

function safeGit(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function stableProjectId(rootPath: string, remote?: string): string {
  const key = remote || resolve(rootPath);
  return `project_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

export function detectProject(cwd = process.cwd(), projectName?: string): ProjectSummary {
  const gitRoot = safeGit(cwd, ["rev-parse", "--show-toplevel"]);
  const rootPath = gitRoot ?? resolve(cwd);
  const gitRemote = safeGit(rootPath, ["remote", "get-url", "origin"]);
  const gitBranch = safeGit(rootPath, ["branch", "--show-current"]);
  const now = new Date().toISOString();

  return {
    id: stableProjectId(rootPath, gitRemote),
    name: projectName || basename(rootPath) || "unknown-project",
    rootPath,
    gitRemote,
    gitBranch,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    metadata: {}
  };
}
