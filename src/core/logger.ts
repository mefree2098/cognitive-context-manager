import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config/load-config.js";
import { redactSecrets } from "./secret-redactor.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export function log(level: LogLevel, message: string, details?: unknown): void {
  const config = loadConfig(process.cwd());
  const logDir = join(config.storage.home, "logs");
  mkdirSync(logDir, { recursive: true });
  const detailsText = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  const redacted = redactSecrets(`${message}${detailsText}`).text;
  appendFileSync(join(logDir, "ccm.log"), `${new Date().toISOString()} ${level.toUpperCase()} ${redacted}\n`);
}
