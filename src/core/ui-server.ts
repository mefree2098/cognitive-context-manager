import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { CcmService } from "./consolidator.js";
import { MetricsService } from "./metrics.js";
import { HygieneService } from "./hygiene.js";
import { EffectivenessReportService } from "./effectiveness-report.js";
import { EmbeddingService } from "./embedding-provider.js";
import { DaemonService } from "./daemon-service.js";
import type { CcmConfig } from "../types/config.js";
import { redactSecrets } from "./secret-redactor.js";

const UI_ASSET_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../assets");

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
  const server = createServer((request, response) => {
    route(request, response, service, config).catch((error: unknown) => errorResponse(response, 500, error));
  });
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

async function route(request: IncomingMessage, response: ServerResponse, service: CcmService, config: CcmConfig): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  if (request.method === "POST" && url.pathname.startsWith("/api/actions/")) {
    await handleAction(url.pathname.slice("/api/actions/".length), response, service, config);
    return;
  }
  if (url.pathname === "/assets/ccm-icon.png") {
    assetResponse(response, "ccm-icon.png", "image/png");
    return;
  }
  if (url.pathname === "/assets/ccm-icon-256.png") {
    assetResponse(response, "ccm-icon-256.png", "image/png");
    return;
  }
  if (url.pathname === "/assets/apple-touch-icon.png") {
    assetResponse(response, "apple-touch-icon.png", "image/png");
    return;
  }
  if (url.pathname === "/assets/favicon-32.png" || url.pathname === "/favicon.ico") {
    assetResponse(response, "favicon-32.png", "image/png");
    return;
  }
  if (url.pathname === "/api/overview") {
    jsonResponse(response, {
      project: service.ensureProjectSession(process.cwd()).project,
      memoryCounts: service.memories.countsByType(),
      openLoops: service.openLoops.list(undefined, false, 20),
      conflicts: service.conflicts.unresolved(undefined, 20),
      contextDividend: new MetricsService(service.db).contextDividend(),
      effectivenessReport: new EffectivenessReportService(service.db, config).report({ since: "7d", sampleLimit: 3 }),
      embeddings: new EmbeddingService(service.db, config).status(),
      daemon: new DaemonService(service.db, config).status(),
      ui: readUiState(config),
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

async function handleAction(action: string, response: ServerResponse, service: CcmService, config: CcmConfig): Promise<void> {
  const hygiene = new HygieneService(service.db, config);
  if (action === "embeddings/process") {
    const embeddings = new EmbeddingService(service.db, config);
    const queued = embeddings.backfill(500);
    const processed = await embeddings.process(50);
    jsonResponse(response, {
      action,
      queued,
      processed,
      status: embeddings.status()
    });
    return;
  }
  if (action === "hygiene/preview") {
    jsonResponse(response, {
      action,
      lowSalience: hygiene.run(true, { limit: 100 }),
      duplicates: hygiene.runDuplicateHygiene(true, { limit: 100, keepRecentHandoffs: 5 }),
      attribution: hygiene.repairAttribution(true, { limit: 100 }),
      report: hygiene.report()
    });
    return;
  }
  if (action === "hygiene/archive-duplicates") {
    jsonResponse(response, {
      action,
      result: hygiene.runDuplicateHygiene(false, { limit: 500, keepRecentHandoffs: 5 }),
      report: hygiene.report()
    });
    return;
  }
  errorResponse(response, 404, new Error(`Unknown CCM UI action: ${action}`));
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cognitive Context Manager</title>
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png" />
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f9; color: #17202a; }
    header { padding: 16px 24px; background: #20242c; color: white; display: flex; align-items: center; gap: 12px; }
    header img { width: 42px; height: 42px; border-radius: 10px; flex: 0 0 auto; }
    main { padding: 24px; display: grid; gap: 16px; grid-template-columns: repeat(12, minmax(0, 1fr)); }
    section { background: white; border: 1px solid #dfe3ea; border-radius: 8px; padding: 16px; min-height: 160px; }
    h1 { font-size: 20px; margin: 0; letter-spacing: 0; }
    h2 { font-size: 15px; margin: 0 0 12px; letter-spacing: 0; }
    h3 { font-size: 12px; color: #5e6a78; font-weight: 700; margin: 0 0 8px; text-transform: uppercase; letter-spacing: .04em; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; background: #f1f3f6; padding: 12px; border-radius: 6px; max-height: 360px; overflow: auto; }
    input { width: 100%; padding: 8px; border: 1px solid #ccd2db; border-radius: 6px; }
    .dashboard { grid-column: 1 / -1; display: grid; gap: 14px; }
    .dashboard-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .dashboard-title { display: grid; gap: 2px; }
    .dashboard-title p { margin: 0; color: #657181; font-size: 13px; }
    .status-line { display: flex; gap: 8px; flex-wrap: wrap; }
    .pill { border: 1px solid #cfd6df; color: #2f3b49; background: #f7f9fb; border-radius: 999px; padding: 5px 9px; font-size: 12px; white-space: nowrap; }
    .pill.good { border-color: #9ac7ad; color: #17633a; background: #edf8f1; }
    .pill.warn { border-color: #d9bd73; color: #7a5300; background: #fff7df; }
    .pill.bad { border-color: #e3a0a0; color: #8c2323; background: #fff0f0; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    button { appearance: none; border: 1px solid #cfd6df; border-radius: 7px; background: #fff; color: #17202a; font: inherit; font-size: 13px; padding: 8px 10px; cursor: pointer; }
    button:hover { background: #f1f4f7; }
    button:disabled { cursor: wait; color: #8a95a3; background: #f5f6f8; }
    button.primary { color: #fff; background: #20242c; border-color: #20242c; }
    button.primary:hover { background: #313742; }
    .action-result { margin: 0; min-height: 44px; max-height: 180px; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    .metric { border: 1px solid #e1e5eb; border-radius: 8px; padding: 12px; background: #fbfcfd; min-height: 86px; display: flex; flex-direction: column; justify-content: space-between; }
    .metric span { color: #657181; font-size: 12px; }
    .metric strong { color: #111820; font-size: clamp(20px, 3vw, 30px); line-height: 1.1; letter-spacing: 0; overflow-wrap: anywhere; }
    .metric small { color: #7b8794; font-size: 11px; }
    .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
    .panel { border: 1px solid #e1e5eb; border-radius: 8px; padding: 12px; background: #fff; }
    .kv { display: grid; grid-template-columns: minmax(110px, .8fr) minmax(0, 1.2fr); gap: 6px 12px; font-size: 13px; }
    .kv dt { color: #657181; }
    .kv dd { margin: 0; color: #17202a; overflow-wrap: anywhere; }
    .wide { grid-column: span 12; }
    .half { grid-column: span 6; }
    .third { grid-column: span 4; }
    @media (max-width: 900px) {
      main { grid-template-columns: 1fr; padding: 14px; }
      .wide, .half, .third { grid-column: 1; }
      .kv { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header><img src="/assets/ccm-icon-256.png" alt="" /><h1>Cognitive Context Manager</h1></header>
  <main>
    <section class="dashboard" aria-label="CCM performance dashboard">
      <div class="dashboard-head">
        <div class="dashboard-title">
          <h2>Performance Dashboard</h2>
          <p id="report-window">Loading CCM effectiveness metrics...</p>
        </div>
        <div id="status-line" class="status-line"></div>
      </div>
      <div class="actions" aria-label="CCM dashboard actions">
        <button type="button" class="primary" data-action="refresh">Refresh Dashboard</button>
        <button type="button" data-action="embeddings/process">Process Embeddings</button>
        <button type="button" data-action="hygiene/preview">Preview Hygiene</button>
        <button type="button" data-action="hygiene/archive-duplicates" data-confirm="Archive duplicate memories and older compact-session handoffs? The newest handoffs stay active.">Archive Duplicate Handoffs</button>
      </div>
      <pre id="action-result" class="action-result">Ready.</pre>
      <div id="metric-grid" class="metric-grid"></div>
      <div id="detail-grid" class="detail-grid"></div>
    </section>
    <section class="third"><h2>Overview</h2><pre id="overview">Loading...</pre></section>
    <section class="third"><h2>Memory Explorer</h2><input id="query" placeholder="Search memories" /><pre id="memories"></pre></section>
    <section class="third"><h2>Context Brief Preview</h2><pre id="context"></pre></section>
  </main>
  <script>
    async function load() {
      const overview = await fetch('/api/overview').then(r => r.json());
      renderDashboard(overview);
      document.getElementById('overview').textContent = JSON.stringify(overview, null, 2);
      await search('');
    }
    async function runAction(action, button) {
      const result = document.getElementById('action-result');
      const buttons = Array.from(document.querySelectorAll('button[data-action]'));
      buttons.forEach(item => item.disabled = true);
      try {
        if (action === 'refresh') {
          await load();
          result.textContent = 'Dashboard refreshed at ' + new Date().toLocaleString();
          return;
        }
        result.textContent = 'Running ' + action + '...';
        const response = await fetch('/api/actions/' + action, { method: 'POST' });
        const payload = await response.json();
        result.textContent = JSON.stringify(payload, null, 2);
        await load();
      } catch (error) {
        result.textContent = 'Action failed: ' + (error && error.message ? error.message : String(error));
      } finally {
        buttons.forEach(item => item.disabled = false);
        if (button) button.focus();
      }
    }
    async function search(q) {
      const memories = await fetch('/api/memories?q=' + encodeURIComponent(q)).then(r => r.json());
      document.getElementById('memories').textContent = JSON.stringify(memories, null, 2);
      const context = await fetch('/api/context?q=' + encodeURIComponent(q || 'Preview context brief')).then(r => r.json());
      document.getElementById('context').textContent = context.working_context_brief;
    }
    function renderDashboard(overview) {
      const report = overview.effectivenessReport || {};
      const summary = report.summary || {};
      const effectiveness = report.effectiveness || {};
      const resilience = report.resilience || {};
      const impact = report.executionImpact || {};
      const reliability = report.reliability || {};
      const pressure = report.memoryPressure || {};
      const publish = report.publishReadiness || {};
      const embeddings = overview.embeddings || {};
      const daemon = overview.daemon || {};
      document.getElementById('report-window').textContent = 'Window: ' + (report.since || '7d') + ' · Generated: ' + formatDate(report.generatedAt);

      const statusLine = document.getElementById('status-line');
      statusLine.innerHTML = '';
      [
        ['Capture', reliability.captureMode || 'none', reliability.captureMode && reliability.captureMode !== 'none' ? 'good' : 'warn'],
        ['Passive proof', reliability.passiveHookProof || 'not_proven', reliability.passiveHookProof === 'host_launch_and_trace_proven' ? 'good' : 'warn'],
        ['Embeddings', embeddings.provider ? embeddings.provider + ' / ' + (embeddings.authSource || 'none') : 'unknown', embeddings.available ? 'good' : 'warn'],
        ['Daemon', daemon.running ? 'running' : 'stopped', daemon.running ? 'good' : 'warn'],
        ['Memory pressure', pressure.level || 'unknown', pressure.level === 'low' || pressure.level === 'moderate' ? 'good' : 'warn']
      ].forEach(([label, value, tone]) => {
        const pill = document.createElement('span');
        pill.className = 'pill ' + tone;
        pill.textContent = label + ': ' + value;
        statusLine.appendChild(pill);
      });

      const metrics = [
        ['Net Token Savings', formatNumber(effectiveness.netEstimatedTokenSavings), 'estimated after injected context'],
        ['Raw Tokens Avoided', formatNumber(effectiveness.estimatedRawTokensAvoided), 'summarized away from live prompt'],
        ['Context Briefs', formatNumber(summary.contextBriefsGenerated), 'working-context activations'],
        ['Memories Stored', formatNumber(summary.memoriesStored), formatNumber(summary.activeMemories) + ' active'],
        ['Execution Score', score(impact.executionContinuityScore), impact.verdict || 'No verdict yet'],
        ['Readiness Score', score(publish.score), publish.verdict || 'No verdict yet'],
        ['Resume Signals', formatNumber(resilience.resumeSignals), 'checkpoint signals: ' + formatNumber(resilience.checkpointSignals)],
        ['Open Loops Preserved', formatNumber(effectiveness.openLoopTasksPreserved), 'unresolved now: ' + formatNumber(impact.unresolvedOpenLoops)],
        ['Embedded Memories', formatNumber(embeddings.embedded), 'queued: ' + formatNumber(embeddings.queued) + ' · failed: ' + formatNumber(embeddings.failed)],
        ['Projects Observed', formatNumber(summary.projectsObserved), formatNumber(summary.sessionsObserved) + ' sessions']
      ];
      document.getElementById('metric-grid').innerHTML = metrics.map(metricCard).join('');

      const detailGrid = document.getElementById('detail-grid');
      detailGrid.innerHTML = [
        detailPanel('Retrieval & Tokens', {
          'Activation rate': percent(effectiveness.contextActivationRate),
          'Injected memory tokens': formatNumber(effectiveness.estimatedInjectedMemoryTokens),
          'Stale excluded': formatNumber(effectiveness.staleOrSupersededMemoriesExcluded),
          'Retrieved memories used': formatNumber(pressure.retrievedMemoriesUsed)
        }),
        detailPanel('Reliability', {
          'Passive hook status': reliability.passiveHookStatus || 'unknown',
          'Passive coverage': formatNumber(reliability.passiveHookCoverage),
          'Hook failures': formatNumber(reliability.hookFailuresLogged),
          'MCP failures': formatNumber(reliability.mcpFailuresLogged),
          'Secrets flagged': formatNumber(reliability.suspectedSecrets)
        }),
        detailPanel('Execution Impact', {
          'Compaction pressure': impact.compactionPressure || 'unknown',
          'Briefs per compaction': formatNumber(impact.contextBriefsPerCompactionSignal),
          'Verification signals': formatNumber(impact.verificationSignals),
          'Completion signals': formatNumber(impact.completionSignals),
          'Recovery/failure ratio': formatNumber(impact.recoveryToFailureRatio)
        }),
        detailPanel('System Status', {
          'Embedding model': embeddings.model || 'unknown',
          'Embedding dimensions': formatNumber(embeddings.dimensions),
          'Daemon queue': formatNumber(daemon.embeddingQueued),
          'Daemon failed jobs': formatNumber(daemon.failedJobs),
          'UI URL': overview.ui && overview.ui.url ? overview.ui.url : window.location.origin
        })
      ].join('');
    }
    function metricCard([label, value, note]) {
      return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong><small>' + escapeHtml(note || '') + '</small></div>';
    }
    function detailPanel(title, rows) {
      return '<div class="panel"><h3>' + escapeHtml(title) + '</h3><dl class="kv">' + Object.entries(rows).map(([key, value]) => '<dt>' + escapeHtml(key) + '</dt><dd>' + escapeHtml(String(value)) + '</dd>').join('') + '</dl></div>';
    }
    function formatNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat().format(value) : '0';
    }
    function score(value) {
      return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) + '/100' : '0/100';
    }
    function percent(value) {
      return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) + '%' : '0%';
    }
    function formatDate(value) {
      if (!value) return 'unknown';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }
    document.querySelectorAll('button[data-action]').forEach(button => {
      button.addEventListener('click', () => {
        if (button.dataset.confirm && !window.confirm(button.dataset.confirm)) return;
        runAction(button.dataset.action, button);
      });
    });
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

function assetResponse(response: ServerResponse, filename: string, contentType: string): void {
  const path = join(UI_ASSET_ROOT, filename);
  if (!existsSync(path)) {
    errorResponse(response, 404, new Error(`Missing UI asset: ${filename}`));
    return;
  }
  response.setHeader("content-type", contentType);
  response.setHeader("cache-control", "public, max-age=3600");
  response.end(readFileSync(path));
}

function errorResponse(response: ServerResponse, status: number, error: unknown): void {
  if (response.writableEnded) return;
  response.statusCode = status;
  jsonResponse(response, { error: error instanceof Error ? error.message : String(error) });
}
