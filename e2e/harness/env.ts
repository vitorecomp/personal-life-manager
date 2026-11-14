import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export interface E2ePaths {
  repoRoot: string;
  e2eRoot: string;
  dataDir: string;
  secondBrainDir: string;
  systemsReqDir: string;
  assetsDir: string;
  webDistDir: string;
  mobileDistDir: string;
}

export interface E2eUrls {
  baseUrl: string;
  apiBaseUrl: string;
  mcpUrl: string;
  mobileUrl: string;
}

const harnessRealDir = fs.realpathSync(import.meta.dirname);
const resolvedE2eRoot = path.resolve(harnessRealDir, '..');
const resolvedRepoRoot = path.resolve(resolvedE2eRoot, '..');

export const E2E_PATHS: E2ePaths = {
  repoRoot: resolvedRepoRoot,
  e2eRoot: resolvedE2eRoot,
  dataDir: path.join(resolvedRepoRoot, 'data'),
  get secondBrainDir(): string {
    return process.env.E2E_SECOND_BRAIN_DIR
      ? path.resolve(process.env.E2E_SECOND_BRAIN_DIR)
      : path.join(resolvedRepoRoot, 'data', 'second-brain');
  },
  systemsReqDir: path.join(resolvedRepoRoot, 'systems-requirements'),
  assetsDir: path.join(resolvedRepoRoot, 'systems-requirements', 'assets'),
  get webDistDir(): string {
    return process.env.E2E_WEB_DIST_DIR
      ? path.resolve(process.env.E2E_WEB_DIST_DIR)
      : path.join(resolvedRepoRoot, 'apps', 'web', 'dist');
  },
  get mobileDistDir(): string {
    return process.env.E2E_MOBILE_DIST_DIR
      ? path.resolve(process.env.E2E_MOBILE_DIST_DIR)
      : path.join(resolvedRepoRoot, 'apps', 'mobile', 'dist');
  },
};

export const E2E_URLS: E2eUrls = {
  get baseUrl(): string {
    return (process.env.E2E_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
  },
  get apiBaseUrl(): string {
    const base = (process.env.E2E_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
    return (process.env.E2E_API_BASE_URL || `${base}/api`).replace(/\/+$/, '');
  },
  get mcpUrl(): string {
    const base = (process.env.E2E_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
    return (process.env.E2E_MCP_URL || `${base}/mcp`).replace(/\/+$/, '');
  },
  get mobileUrl(): string {
    return (process.env.E2E_MOBILE_URL || 'http://127.0.0.1:4174').replace(/\/+$/, '');
  },
};

const STATIC_MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function extractCandidateBinNames(): string[] {
  const names: string[] = [];
  const serverCargoToml = path.join(E2E_PATHS.repoRoot, 'backend', 'crates', 'server', 'Cargo.toml');
  if (fs.existsSync(serverCargoToml)) {
    try {
      const raw = fs.readFileSync(serverCargoToml, 'utf8');
      const binBlockMatches = raw.matchAll(/\[\[bin\]\][\s\S]*?name\s*=\s*"([^"]+)"/g);
      for (const m of binBlockMatches) {
        if (m[1]) names.push(m[1]);
      }
      const pkgMatch = raw.match(/\[package\][\s\S]*?name\s*=\s*"([^"]+)"/);
      if (pkgMatch?.[1]) {
        names.push(pkgMatch[1]);
      }
    } catch {
      // Ignore parse errors and fall back to standard names
    }
  }
  for (const fallback of ['server', 'hermes-server', 'hermes-os-server', 'hermes-os']) {
    if (!names.includes(fallback)) names.push(fallback);
  }
  return names;
}

function findBuiltBackendBinary(candidateNames: string[]): string | null {
  const targetRoots = [
    process.env.CARGO_TARGET_DIR ? path.resolve(process.env.CARGO_TARGET_DIR) : null,
    path.join(E2E_PATHS.repoRoot, 'backend', 'target'),
    path.join(E2E_PATHS.repoRoot, 'target'),
  ].filter((p): p is string => Boolean(p));

  const found: Array<{ filePath: string; mtimeMs: number }> = [];
  for (const root of targetRoots) {
    for (const profile of ['release', 'debug']) {
      for (const binName of candidateNames) {
        const candidate = path.join(root, profile, binName);
        if (isExecutableFile(candidate)) {
          const stat = fs.statSync(candidate);
          found.push({ filePath: candidate, mtimeMs: stat.mtimeMs });
        }
      }
    }
  }

  if (found.length === 0) return null;
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found[0].filePath;
}

export function resolveBackendBinary(): string {
  if (process.env.E2E_BACKEND_BIN) {
    const explicit = path.resolve(process.env.E2E_BACKEND_BIN);
    if (isExecutableFile(explicit)) {
      return explicit;
    }
    throw new Error(`E2E_BACKEND_BIN is set to "${explicit}", but it is not an executable file.`);
  }

  const candidateNames = extractCandidateBinNames();
  const existing = findBuiltBackendBinary(candidateNames);
  if (existing) return existing;

  const workspaceManifest = path.join(E2E_PATHS.repoRoot, 'backend', 'Cargo.toml');
  if (fs.existsSync(workspaceManifest) && process.env.E2E_ALLOW_CARGO_BUILD !== 'false') {
    execFileSync('cargo', ['build', '--manifest-path', workspaceManifest], {
      cwd: path.join(E2E_PATHS.repoRoot, 'backend'),
      stdio: 'inherit',
    });
    const built = findBuiltBackendBinary(candidateNames);
    if (built) return built;
  }

  throw new Error(
    `Unable to locate built backend binary (searched names: [${candidateNames.join(', ')}] under backend/target/{release,debug}).`,
  );
}

async function probeHttpOk(url: string, timeoutMs = 2_000): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.arrayBuffer().catch(() => {});
    return res.ok;
  } catch {
    return false;
  }
}

async function allocateFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Failed to read ephemeral port')));
        return;
      }
      const { port } = addr;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function buildDefaultBackendEnv(port: string, host = '127.0.0.1'): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    HOST: host,
    PORT: port,
    HERMES_SERVER_PORT: port,
    BIND_ADDR: `${host}:${port}`,
    DATABASE_URL:
      process.env.DATABASE_URL || 'postgres://hermes:hermes@127.0.0.1:5432/hermes_os',
    REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    HERMES_GATEWAY_URL: process.env.HERMES_GATEWAY_URL || 'http://127.0.0.1:8642/v1',
    STATIC_DIST_DIR: E2E_PATHS.webDistDir,
    YOUTUBE_LISTS_DB:
      process.env.YOUTUBE_LISTS_DB ||
      path.join(E2E_PATHS.dataDir, 'database', 'youtube-lists.sqlite'),
    YOUTUBE_LISTS_NOTES_DIR:
      process.env.YOUTUBE_LISTS_NOTES_DIR ||
      path.join(E2E_PATHS.dataDir, 'knowledge-data', 'lists', 'youtube'),
    SECOND_BRAIN_DIR: E2E_PATHS.secondBrainDir,
    HERMES_ADMIN_USER: process.env.HERMES_ADMIN_USER || 'operator',
    HERMES_ADMIN_PASSWORD: process.env.HERMES_ADMIN_PASSWORD || 'hermes-os-local',
    REQUIRE_WEB_LOGIN: process.env.REQUIRE_WEB_LOGIN || 'false',
  };
}

async function terminateChildProcess(child: ChildProcess, graceMs = 3_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve();
    };
    child.once('exit', finish);
    child.once('error', finish);
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore if already dead
      }
      finish();
    }, graceMs);
    killTimer.unref();
    try {
      child.kill('SIGTERM');
    } catch {
      finish();
    }
  });
}

let managedBackendChild: ChildProcess | null = null;
let managedBackendUrl: string | null = null;
let managedBackendPromise: Promise<void> | null = null;

let managedMobileServer: http.Server | null = null;
let managedMobileSockets = new Set<net.Socket>();
let managedMobileUrl: string | null = null;
let managedMobilePromise: Promise<void> | null = null;

let exitHookRegistered = false;
function registerProcessExitHook(): void {
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  process.once('exit', () => {
    if (managedBackendChild && managedBackendChild.exitCode === null) {
      try {
        managedBackendChild.kill('SIGTERM');
      } catch {
        // Ignore
      }
    }
    if (managedMobileServer) {
      for (const sock of managedMobileSockets) {
        sock.destroy();
      }
      managedMobileSockets.clear();
      try {
        managedMobileServer.close();
      } catch {
        // Ignore
      }
    }
  });
}

async function startManagedBackend(baseUrl: string): Promise<void> {
  const parsed = new URL(baseUrl);
  const host = parsed.hostname || '127.0.0.1';
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const binPath = resolveBackendBinary();
  const backendDir = path.join(E2E_PATHS.repoRoot, 'backend');
  const cwd = fs.existsSync(backendDir) ? backendDir : E2E_PATHS.repoRoot;

  let outputTail = '';
  const appendLog = (chunk: Buffer | string) => {
    outputTail = (outputTail + chunk.toString()).slice(-8192);
  };

  let spawnErr: Error | null = null;
  const child = spawn(binPath, [], {
    cwd,
    env: buildDefaultBackendEnv(port, host),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('error', (err) => {
    spawnErr = err;
  });
  child.stdout?.on('data', appendLog);
  child.stderr?.on('data', appendLog);
  child.unref();

  managedBackendChild = child;
  managedBackendUrl = baseUrl;
  registerProcessExitHook();

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (spawnErr) {
      managedBackendChild = null;
      managedBackendUrl = null;
      throw new Error(
        `Failed to spawn managed backend "${binPath}": ${(spawnErr as Error).message}. Output:\n${outputTail}`,
      );
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      managedBackendChild = null;
      managedBackendUrl = null;
      throw new Error(
        `Managed backend exited prematurely (code=${child.exitCode}, signal=${child.signalCode}). Output:\n${outputTail}`,
      );
    }
    if (await probeHttpOk(`${baseUrl}/api/health`, 1_500)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  await terminateChildProcess(child);
  managedBackendChild = null;
  managedBackendUrl = null;
  if (spawnErr) {
    throw new Error(
      `Failed to spawn managed backend "${binPath}": ${(spawnErr as Error).message}. Output:\n${outputTail}`,
    );
  }
  throw new Error(
    `Timed out waiting 20s for managed backend health at ${baseUrl}/api/health. Output:\n${outputTail}`,
  );
}

async function startManagedMobileServer(mobileUrl: string): Promise<void> {
  const mobileDist = E2E_PATHS.mobileDistDir;
  const indexHtmlPath = path.join(mobileDist, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(
      `Mobile static bundle not found at ${indexHtmlPath}. Build @hermes/mobile before running mobile E2E tests.`,
    );
  }

  const parsed = new URL(mobileUrl);
  const host = parsed.hostname || '127.0.0.1';
  const port = Number(parsed.port || '4174');
  const resolvedRoot = fs.realpathSync(mobileDist);
  const sockets = new Set<net.Socket>();

  const server = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', `http://${host}:${port}`);
      const decodedPathname = decodeURIComponent(reqUrl.pathname);
      const candidate = path.resolve(resolvedRoot, `.${decodedPathname}`);
      if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Forbidden');
        return;
      }

      let fileToServe: string | null = null;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        fileToServe = candidate;
      } else if (decodedPathname === '/' || path.extname(decodedPathname) === '') {
        fileToServe = path.join(resolvedRoot, 'index.html');
      }

      if (!fileToServe || !fs.existsSync(fileToServe)) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Not Found');
        return;
      }

      const ext = path.extname(fileToServe).toLowerCase();
      const mime = STATIC_MIME_MAP[ext] || 'application/octet-stream';
      res.statusCode = 200;
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-cache');
      const stream = fs.createReadStream(fileToServe);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.statusCode = 500;
        }
        res.end();
      });
      stream.pipe(res);
    } catch {
      if (!res.headersSent) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      }
      res.end('Bad Request');
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  server.unref();
  managedMobileServer = server;
  managedMobileSockets = sockets;
  managedMobileUrl = mobileUrl;
  registerProcessExitHook();
}

export async function ensureStackReady(options?: {
  requireMobile?: boolean;
}): Promise<{ baseUrl: string; mobileUrl: string }> {
  const baseUrl = E2E_URLS.baseUrl;
  const mobileUrl = E2E_URLS.mobileUrl;

  if (!(await probeHttpOk(`${baseUrl}/api/health`, 2_000))) {
    if (process.env.E2E_AUTO_START === 'false') {
      throw new Error(
        `Backend at ${baseUrl}/api/health is unreachable and E2E_AUTO_START=false.`,
      );
    }
    if (!managedBackendPromise || managedBackendUrl !== baseUrl) {
      managedBackendPromise = startManagedBackend(baseUrl).finally(() => {
        managedBackendPromise = null;
      });
    }
    await managedBackendPromise;
  }

  if (options?.requireMobile) {
    if (!(await probeHttpOk(`${mobileUrl}/`, 2_000))) {
      if (process.env.E2E_AUTO_START === 'false') {
        throw new Error(
          `Mobile server at ${mobileUrl}/ is unreachable and E2E_AUTO_START=false.`,
        );
      }
      if (!managedMobilePromise || managedMobileUrl !== mobileUrl) {
        managedMobilePromise = startManagedMobileServer(mobileUrl).finally(() => {
          managedMobilePromise = null;
        });
      }
      await managedMobilePromise;
    }
  }

  return { baseUrl, mobileUrl };
}

export async function stopManagedStack(): Promise<void> {
  if (managedBackendChild) {
    const child = managedBackendChild;
    managedBackendChild = null;
    managedBackendUrl = null;
    await terminateChildProcess(child);
  }
  if (managedMobileServer) {
    const srv = managedMobileServer;
    const sockets = managedMobileSockets;
    managedMobileServer = null;
    managedMobileUrl = null;
    managedMobileSockets = new Set();
    for (const sock of sockets) {
      sock.destroy();
    }
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
}

export async function withIsolatedBackend(
  overrides: Record<string, string>,
  fn: (ctx: { baseUrl: string; apiBaseUrl: string; mcpUrl: string }) => Promise<void>,
): Promise<void> {
  const binPath = resolveBackendBinary();
  const host = overrides.HOST || '127.0.0.1';
  const port = overrides.PORT ? Number(overrides.PORT) : await allocateFreePort(host);
  const portStr = String(port);
  const baseUrl = `http://${host}:${portStr}`;
  const backendDir = path.join(E2E_PATHS.repoRoot, 'backend');
  const cwd = fs.existsSync(backendDir) ? backendDir : E2E_PATHS.repoRoot;

  let tempVaultDir: string | null = null;
  let child: ChildProcess | null = null;

  try {
    if (!overrides.SECOND_BRAIN_DIR) {
      tempVaultDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `hermes-e2e-vault-${process.pid}-${crypto.randomUUID().slice(0, 8)}-`),
      );
    }

    const mergedEnv: Record<string, string> = {
      ...buildDefaultBackendEnv(portStr, host),
      ...(tempVaultDir ? { SECOND_BRAIN_DIR: tempVaultDir } : {}),
      ...overrides,
      HOST: host,
      PORT: portStr,
      HERMES_SERVER_PORT: portStr,
      BIND_ADDR: `${host}:${portStr}`,
    };

    let outputTail = '';
    const appendLog = (chunk: Buffer | string) => {
      outputTail = (outputTail + chunk.toString()).slice(-8192);
    };

    let spawnErr: Error | null = null;
    child = spawn(binPath, [], {
      cwd,
      env: mergedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('error', (err) => {
      spawnErr = err;
    });
    child.stdout?.on('data', appendLog);
    child.stderr?.on('data', appendLog);

    const deadline = Date.now() + 15_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (spawnErr) {
        throw new Error(
          `Failed to spawn isolated backend "${binPath}": ${(spawnErr as Error).message}. Output:\n${outputTail}`,
        );
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Isolated backend exited before becoming healthy (code=${child.exitCode}, signal=${child.signalCode}). Output:\n${outputTail}`,
        );
      }
      if (await probeHttpOk(`${baseUrl}/api/health`, 1_000)) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    if (spawnErr) {
      throw new Error(
        `Failed to spawn isolated backend "${binPath}": ${(spawnErr as Error).message}. Output:\n${outputTail}`,
      );
    }
    if (!ready) {
      throw new Error(
        `Timed out waiting 15s for isolated backend health at ${baseUrl}/api/health. Output:\n${outputTail}`,
      );
    }

    await fn({
      baseUrl,
      apiBaseUrl: `${baseUrl}/api`,
      mcpUrl: `${baseUrl}/mcp`,
    });
  } finally {
    if (child) {
      await terminateChildProcess(child, 3_000);
    }
    if (tempVaultDir) {
      fs.rmSync(tempVaultDir, { recursive: true, force: true });
    }
  }
}
