import { z } from "zod";
import { redactSecrets } from "./secret-redactor.js";
import { truncateToTokens } from "./tokenizer.js";

export interface EventSummarizationInput {
  text: string;
  source: "hook" | "tool" | "user" | "import";
}

export interface ToolOutputSummarizationInput {
  command?: string;
  output: string;
  exitCode?: number;
}

export interface EventSummary {
  event_type: "decision" | "blocker" | "preference" | "tool_result" | "artifact_change" | "open_loop" | "correction" | "other";
  summary: string;
  durability: "ephemeral" | "session" | "project" | "global";
  salience: number;
  entities: string[];
  decisions: string[];
  constraints: string[];
  open_loops: string[];
  supersedes: string[];
  safety_flags: string[];
}

export interface ToolOutputSummary {
  summary: string;
  exitCode?: number;
  errors: string[];
  changedFiles: string[];
  testStatus: "passed" | "failed" | "unknown";
  rawTokensAvoided: number;
}

export interface ProjectStateDelta {
  decisions: string[];
  constraints: string[];
  openLoops: string[];
  warnings: string[];
}

export interface SummarizationProvider {
  id: string;
  displayName: string;
  isAvailable(): Promise<boolean>;
  summarizeEvent(input: EventSummarizationInput): Promise<EventSummary>;
  summarizeToolOutput(input: ToolOutputSummarizationInput): Promise<ToolOutputSummary>;
  updateProjectState(input: { text: string }): Promise<ProjectStateDelta>;
}

export const eventSummarySchema = z.object({
  event_type: z.enum(["decision", "blocker", "preference", "tool_result", "artifact_change", "open_loop", "correction", "other"]),
  summary: z.string(),
  durability: z.enum(["ephemeral", "session", "project", "global"]),
  salience: z.number().min(0).max(1),
  entities: z.array(z.string()),
  decisions: z.array(z.string()),
  constraints: z.array(z.string()),
  open_loops: z.array(z.string()),
  supersedes: z.array(z.string()),
  safety_flags: z.array(z.string())
});

export class DeterministicSummarizationProvider implements SummarizationProvider {
  id = "deterministic";
  displayName = "Deterministic rules";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async summarizeEvent(input: EventSummarizationInput): Promise<EventSummary> {
    const redacted = redactSecrets(input.text).text;
    const summary = truncateToTokens(redacted.replace(/\s+/g, " ").trim(), 160);
    const lower = redacted.toLowerCase();
    const eventType: EventSummary["event_type"] = lower.includes("from now on") || lower.includes("prefer")
      ? "preference"
      : lower.includes("decision") || lower.includes("we will")
        ? "decision"
        : lower.includes("todo") || lower.includes("follow up") || lower.includes("blocker")
          ? "open_loop"
          : lower.includes("failed") || lower.includes("error")
            ? "blocker"
            : "other";
    return eventSummarySchema.parse({
      event_type: eventType,
      summary,
      durability: eventType === "preference" || eventType === "decision" ? "project" : "session",
      salience: eventType === "preference" || eventType === "decision" ? 0.85 : 0.55,
      entities: [...redacted.matchAll(/`([^`]+)`/g)].map((match) => match[1]).slice(0, 12),
      decisions: eventType === "decision" ? [summary] : [],
      constraints: eventType === "preference" ? [summary] : [],
      open_loops: eventType === "open_loop" ? [summary] : [],
      supersedes: [],
      safety_flags: redactSecrets(input.text).redactions
    });
  }

  async summarizeToolOutput(input: ToolOutputSummarizationInput): Promise<ToolOutputSummary> {
    const redacted = redactSecrets(input.output).text;
    const errors = redacted
      .split(/\r?\n/)
      .filter((line) => /\b(error|failed|exception|timeout|denied)\b/i.test(line))
      .slice(0, 20);
    const changedFiles = [...redacted.matchAll(/\b[\w./-]+\.(?:ts|tsx|js|jsx|json|md|sql|py|go|rs|swift|kt|java|css|html)\b/g)]
      .map((match) => match[0])
      .slice(0, 30);
    const testStatus = input.exitCode === 0 ? "passed" : input.exitCode && input.exitCode !== 0 ? "failed" : "unknown";
    return {
      summary: truncateToTokens(
        [
          input.command ? `Command: ${input.command}` : undefined,
          input.exitCode !== undefined ? `Exit code: ${input.exitCode}` : undefined,
          errors.length ? `Errors: ${errors.join(" | ")}` : undefined,
          `Excerpt: ${redacted.slice(0, 1200)}`
        ]
          .filter(Boolean)
          .join("\n"),
        500
      ),
      exitCode: input.exitCode,
      errors,
      changedFiles: [...new Set(changedFiles)],
      testStatus,
      rawTokensAvoided: Math.max(0, Math.ceil(redacted.length / 4) - 500)
    };
  }

  async updateProjectState(input: { text: string }): Promise<ProjectStateDelta> {
    const summary = await this.summarizeEvent({ text: input.text, source: "hook" });
    return {
      decisions: summary.decisions,
      constraints: summary.constraints,
      openLoops: summary.open_loops,
      warnings: summary.safety_flags
    };
  }
}
