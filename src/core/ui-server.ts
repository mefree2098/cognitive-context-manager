import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type Database from "better-sqlite3";
import { CcmService } from "./consolidator.js";
import { MetricsService } from "./metrics.js";
import { HygieneService } from "./hygiene.js";
import { EffectivenessReportService } from "./effectiveness-report.js";
import type { CcmConfig } from "../types/config.js";
import { redactSecrets } from "./secret-redactor.js";

export interface UiServerHandle {
  url: string;
  host: string;
  port: number;
  requestedPort: number;
  portShifted: boolean;
  close: () => Promise<void>;
}

export interface UiServerState {
  url: string;
  host: string;
  port: number;
  requestedPort: number;
  portShifted: boolean;
  startedAt: string;
  pid: number;
}

export async function startUiServer(db: Database.Database, config: CcmConfig): Promise<UiServerHandle> {
  const host = config.ui.host || "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("CCM UI refuses non-localhost binding by default");
  const requestedPort = normalizePort(config.ui.port || 4388);
  const portScanRange = Math.max(0, Number(config.ui.portScanRange) || 0);
  const service = new CcmService({ db, repoPath: process.cwd() });

  for (let offset = 0; offset <= portScanRange; offset += 1) {
    const candidatePort = requestedPort === 0 ? 0 : requestedPort + offset;
    try {
      const server = await listen(service, config, host, candidatePort);
      const address = server.address() as AddressInfo;
      const actualPort = address.port;
      const handle = {
        url: `http://${host}:${actualPort}`,
        host,
        port: actualPort,
        requestedPort,
        portShifted: actualPort !== requestedPort,
        close: () =>
          new Promise<void>((closeResolve, closeReject) =>
            server.close((error) => {
              removeUiState(config);
              if (error) closeReject(error);
              else closeResolve();
            })
          )
      };
      writeUiState(config, handle);
      return handle;
    } catch (error) {
      if (!isPortConflict(error) || offset === portScanRange || requestedPort === 0) throw error;
    }
  }

  throw new Error(`Unable to find an available CCM UI port starting at ${requestedPort}.`);
}

export function readUiState(config: CcmConfig): UiServerState | undefined {
  const path = uiStatePath(config);
  if (!existsSync(path)) return undefined;
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as UiServerState;
    if (!isAlive(state.pid)) return undefined;
    return state;
  } catch {
    return undefined;
  }
}

function listen(service: CcmService, config: CcmConfig, host: string, port: number): Promise<ReturnType<typeof createServer>> {
  const server = createServer((request, response) => route(request, response, service, config));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function writeUiState(config: CcmConfig, handle: Omit<UiServerHandle, "close">): void {
  try {
    mkdirSync(join(config.storage.home, "run"), { recursive: true });
    const state: UiServerState = {
      url: handle.url,
      host: handle.host,
      port: handle.port,
      requestedPort: handle.requestedPort,
      portShifted: handle.portShifted,
      startedAt: new Date().toISOString(),
      pid: process.pid
    };
    writeFileSync(uiStatePath(config), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    // The dashboard should still run if its status file cannot be written.
  }
}

function removeUiState(config: CcmConfig): void {
  try {
    const path = uiStatePath(config);
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Best effort cleanup.
  }
}

function uiStatePath(config: CcmConfig): string {
  return join(config.storage.home, "run", "ui.json");
}

function normalizePort(port: number): number {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`Invalid CCM UI port: ${port}`);
  return port;
}

function isPortConflict(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "EADDRINUSE" || code === "EACCES";
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function route(request: IncomingMessage, response: ServerResponse, service: CcmService, config: CcmConfig): void {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  if (url.pathname === "/api/overview") {
    jsonResponse(response, {
      project: service.ensureProjectSession(process.cwd()).project,
      memoryCounts: service.memories.countsByType(),
      openLoops: service.openLoops.list(undefined, false, 20),
      conflicts: service.conflicts.unresolved(undefined, 20),
      contextDividend: new MetricsService(service.db).contextDividend(),
      effectivenessReport: new EffectivenessReportService(service.db, config).report({ since: "7d", sampleLimit: 3 }),
      hygiene: new HygieneService(service.db, config).report()
    });
    return;
  }
  if (url.pathname === "/api/memories") {
    jsonResponse(response, { memories: service.searchMemories({ query: url.searchParams.get("q") ?? "", includeStale: true, limit: 50 }) });
    return;
  }
  if (url.pathname === "/api/context") {
    jsonResponse(response, service.getWorkingContext({ task: url.searchParams.get("q") ?? "Preview context brief", repoPath: process.cwd() }));
    return;
  }
  htmlResponse(response, dashboardHtml());
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cognitive Context Manager</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f9; color: #17202a; }
    header { padding: 18px 24px; background: #20242c; color: white; }
    main { padding: 24px; display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    section { background: white; border: 1px solid #dfe3ea; border-radius: 8px; padding: 16px; min-height: 160px; }
    h1 { font-size: 20px; margin: 0; }
    h2 { font-size: 15px; margin: 0 0 12px; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; background: #f1f3f6; padding: 12px; border-radius: 6px; max-height: 360px; overflow: auto; }
    input { width: calc(100% - 18px); padding: 8px; border: 1px solid #ccd2db; border-radius: 6px; }
  </style>
</head>
<body>
  <header><h1>Cognitive Context Manager</h1></header>
  <main>
    <section><h2>Overview</h2><pre id="overview">Loading...</pre></section>
    <section><h2>Memory Explorer</h2><input id="query" placeholder="Search memories" /><pre id="memories"></pre></section>
    <section><h2>Context Brief Preview</h2><pre id="context"></pre></section>
  </main>
  <script>
    async function load() {
      const overview = await fetch('/api/overview').then(r => r.json());
      document.getElementById('overview').textContent = JSON.stringify(overview, null, 2);
      await search('');
    }
    async function search(q) {
      const memories = await fetch('/api/memories?q=' + encodeURIComponent(q)).then(r => r.json());
      document.getElementById('memories').textContent = JSON.stringify(memories, null, 2);
      const context = await fetch('/api/context?q=' + encodeURIComponent(q || 'Preview context brief')).then(r => r.json());
      document.getElementById('context').textContent = context.working_context_brief;
    }
    document.getElementById('query').addEventListener('input', event => search(event.target.value));
    load();
  </script>
</body>
</html>`;
}

function jsonResponse(response: ServerResponse, value: unknown): void {
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(redactSecrets(JSON.stringify(value, null, 2)).text);
}

function htmlResponse(response: ServerResponse, value: string): void {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(value);
}
