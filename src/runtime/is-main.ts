import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isMainModule(metaUrl: string, argvPath = process.argv[1]): boolean {
  if (!argvPath) return false;
  const modulePath = fileURLToPath(metaUrl);
  const invokedPath = resolve(argvPath);
  try {
    return realpathSync(modulePath) === realpathSync(invokedPath);
  } catch {
    return modulePath === invokedPath;
  }
}
