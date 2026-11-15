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
  youtubeListsDb: string;
  youtubeListsNotesDir: string;
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

export interface SafePathGuardOptions {
  requireInsideTmp?: boolean;
  extraProtectedRoots?: string[];
}

const harnessRealDir = fs.realpathSync(import.meta.dirname);
const resolvedE2eRoot = path.resolve(harnessRealDir, '..');
const resolvedRepoRoot = path.resolve(resolvedE2eRoot, '..');

/**
 * Primary protected data root (<repo>/data). Computed lexically from the
 * canonicalized repo root so `<repo>/data` is never stat'd or realpath'd.
 */
export const PRIMARY_PROTECTED_DATA_ROOT = path.join(resolvedRepoRoot, 'data');

export const VAULT_OWNERSHIP_MARKER_FILE = '.hermes-e2e-vault-root';
const HARNESS_OWNED_VAULT_ROOTS = new Set<string>();

function isInsideOrEqual(childPath: string, parentPath: string): boolean {
  const c = path.resolve(childPath);
  const p = path.resolve(parentPath);
  if (p === path.sep) return true;
  return c === p || c.startsWith(p + path.sep);
}

function lstatIsSymlink(targetPath: string): boolean {
  try {
    return fs.lstatSync(targetPath).isSymbolicLink();
  } catch {
    return false;
  }
}

export function canonicalizeWithMissingLeaf(absPath: string, depth = 0): string {
  const lexical = path.resolve(absPath);
  if (isInsideOrEqual(lexical, PRIMARY_PROTECTED_DATA_ROOT)) {
    return lexical;
  }
  if (depth > 16) {
    return lexical;
  }

  const tailSegments: string[] = [];
  let cur = lexical;
  while (true) {
    if (isInsideOrEqual(cur, PRIMARY_PROTECTED_DATA_ROOT)) {
      return path.resolve(cur, ...tailSegments);
    }
    if (fs.existsSync(cur) || lstatIsSymlink(cur)) {
      break;
    }
    const parent = path.dirname(cur);
    if (parent === cur) {
      break;
    }
    tailSegments.unshift(path.basename(cur));
    cur = parent;
  }

  let realBase = cur;
  if (!isInsideOrEqual(cur, PRIMARY_PROTECTED_DATA_ROOT)) {
    if (fs.existsSync(cur)) {
      try {
        realBase = fs.realpathSync(cur);
      } catch {
        realBase = cur;
      }
    } else if (lstatIsSymlink(cur)) {
      try {
        const linkTarget = fs.readlinkSync(cur);
        const resolvedTarget = path.resolve(path.dirname(cur), linkTarget);
        realBase = canonicalizeWithMissingLeaf(resolvedTarget, depth + 1);
      } catch {
        realBase = cur;
      }
    }
  }

  return path.resolve(realBase, ...tailSegments);
}

export function getProtectedDataRoots(extraRoots?: string[]): string[] {
  const roots = new Set<string>([PRIMARY_PROTECTED_DATA_ROOT]);
  const rawEnv = [
    process.env.E2E_PROTECTED_DATA_ROOTS || '',
    process.env.E2E_EXTRA_PROTECTED_DATA_ROOTS || '',
  ]
    .filter(Boolean)
    .join(path.delimiter);

  const candidates = [
    ...rawEnv
      .split(new RegExp(`[${path.delimiter},]`))
      .map((s) => s.trim())
      .filter(Boolean),
    ...(extraRoots || []).map((s) => String(s).trim()).filter(Boolean),
  ];

  for (const cand of candidates) {
    const lex = path.resolve(cand);
    roots.add(lex);
    if (!isInsideOrEqual(lex, PRIMARY_PROTECTED_DATA_ROOT)) {
      roots.add(canonicalizeWithMissingLeaf(lex));
    }
  }

  return Array.from(roots);
}

export function assertSafeE2eDataPath(
  rawPath: unknown,
  label = 'path',
  options?: SafePathGuardOptions,
): string {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new Error(
      `[E2E-SAFETY-GUARD] R2: Refusing empty or non-string path for ${label}.`,
    );
  }

  const trimmed = rawPath.trim();
  const candidateBases = path.isAbsolute(trimmed)
    ? [path.resolve(trimmed)]
    : [
        path.resolve(process.cwd(), trimmed),
        path.resolve(resolvedRepoRoot, trimmed),
        path.resolve(resolvedE2eRoot, trimmed),
        path.resolve(resolvedRepoRoot, 'backend', trimmed),
      ];

  const protectedRoots = getProtectedDataRoots(options?.extraProtectedRoots);
  const lexTmp = path.resolve(os.tmpdir());
  const realTmp = canonicalizeWithMissingLeaf(lexTmp);

  for (const cand of candidateBases) {
    const candLex = path.resolve(cand);
    const candReal = canonicalizeWithMissingLeaf(candLex);

    if (
      candLex === lexTmp ||
      candLex === realTmp ||
      candReal === lexTmp ||
      candReal === realTmp
    ) {
      throw new Error(
        `[E2E-SAFETY-GUARD] R2: Refusing bare os.tmpdir() root "${rawPath}" for ${label}; a dedicated temporary subdirectory is required.`,
      );
    }

    for (const protRoot of protectedRoots) {
      if (isInsideOrEqual(candLex, protRoot) || isInsideOrEqual(candReal, protRoot)) {
        throw new Error(
          `[E2E-SAFETY-GUARD] R2: Refusing unsafe path for ${label}: "${rawPath}" resolves to "${candReal}" which is inside protected data root "${protRoot}".`,
        );
      }
      if (isInsideOrEqual(protRoot, candLex) || isInsideOrEqual(protRoot, candReal)) {
        throw new Error(
          `[E2E-SAFETY-GUARD] R2: Refusing unsafe ancestor path for ${label}: "${rawPath}" resolves to "${candReal}" which overlaps protected data root "${protRoot}".`,
        );
      }
    }
  }

  const primaryLex = path.resolve(trimmed);
  const primaryReal = canonicalizeWithMissingLeaf(primaryLex);

  if (options?.requireInsideTmp) {
    const insideRealTmp =
      primaryReal.startsWith(realTmp + path.sep) && primaryReal !== realTmp;
    const insideLexTmp =
      primaryLex.startsWith(lexTmp + path.sep) && primaryLex !== lexTmp;
    if (!insideRealTmp && !insideLexTmp) {
      throw new Error(
        `[E2E-SAFETY-GUARD] R2/R4: Refusing path outside os.tmpdir() for ${label}: "${rawPath}" (resolved to "${primaryReal}").`,
      );
    }
  }

  return primaryReal;
}

export function isSafeE2eDataPath(
  rawPath: unknown,
  options?: SafePathGuardOptions,
): boolean {
  try {
    assertSafeE2eDataPath(rawPath, 'check', options);
    return true;
  } catch {
    return false;
  }
}

function collectExistingSubdirsRelPosix(rootRealPath: string): string[] {
  const dirs: string[] = [];
  if (!fs.existsSync(rootRealPath)) return dirs;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === '.git' ||
        entry.name === '.obsidian' ||
        entry.name === VAULT_OWNERSHIP_MARKER_FILE
      ) {
        continue;
      }
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const full = path.join(dir, entry.name);
        const relPosix = path.relative(rootRealPath, full).split(path.sep).join('/');
        dirs.push(relPosix);
        walk(full);
      }
    }
  };
  walk(rootRealPath);
  return dirs;
}

export function registerHarnessOwnedVaultRoot(dirPath: string): string {
  const safePath = assertSafeE2eDataPath(dirPath, 'registerHarnessOwnedVaultRoot', {
    requireInsideTmp: true,
  });

  if (fs.existsSync(dirPath) && lstatIsSymlink(dirPath)) {
    throw new Error(
      `[E2E-SAFETY-GUARD] R4: Refusing symlinked vault root "${dirPath}".`,
    );
  }

  fs.mkdirSync(safePath, { recursive: true });
  const realRoot = fs.realpathSync(safePath);

  if (
    fs.existsSync(path.join(realRoot, '.git')) ||
    fs.existsSync(path.join(realRoot, '.obsidian'))
  ) {
    throw new Error(
      `[E2E-SAFETY-GUARD] R4: Refusing to register vault root containing .git or .obsidian: "${realRoot}".`,
    );
  }

  const markerPath = path.join(realRoot, VAULT_OWNERSHIP_MARKER_FILE);
  let initialDirs: string[] = [];
  if (fs.existsSync(markerPath)) {
    try {
      const existingMarker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (Array.isArray(existingMarker?.initialDirs)) {
        initialDirs = existingMarker.initialDirs;
      }
    } catch {
      initialDirs = collectExistingSubdirsRelPosix(realRoot);
    }
  } else {
    initialDirs = collectExistingSubdirsRelPosix(realRoot);
  }

  const payload = {
    createdBy: 'hermes-e2e-harness',
    rootRealPath: realRoot,
    runToken: process.env.E2E_RUN_TOKEN || '',
    initialDirs,
  };
  fs.writeFileSync(markerPath, JSON.stringify(payload, null, 2), 'utf8');
  HARNESS_OWNED_VAULT_ROOTS.add(realRoot);
  return realRoot;
}

export function getVaultOwnershipInfo(
  realRoot: string,
): { owned: boolean; initialDirs: Set<string> } {
  const initialDirs = new Set<string>();
  const markerPath = path.join(realRoot, VAULT_OWNERSHIP_MARKER_FILE);
  if (fs.existsSync(markerPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (
        parsed?.createdBy === 'hermes-e2e-harness' &&
        parsed?.rootRealPath === realRoot
      ) {
        if (Array.isArray(parsed.initialDirs)) {
          for (const d of parsed.initialDirs) {
            if (typeof d === 'string') initialDirs.add(d);
          }
        }
        return { owned: true, initialDirs };
      }
    } catch {
      // Fall through
    }
  }
  if (HARNESS_OWNED_VAULT_ROOTS.has(realRoot)) {
    return { owned: true, initialDirs };
  }
  return { owned: false, initialDirs };
}

export function isHarnessOwnedVaultRoot(dirPath: string): boolean {
  try {
    if (!dirPath || !fs.existsSync(dirPath)) return false;
    const realRoot = fs.realpathSync(dirPath);
    return getVaultOwnershipInfo(realRoot).owned;
  } catch {
    return false;
  }
}

let fixtureExitHookRegistered = false;

export function ensureRunFixtureEnv(): string {
  const isStaticMode =
    process.argv.includes('--list') ||
    process.argv.includes('--dry-check') ||
    process.env.E2E_STATIC_MODE === '1';

  if (!process.env.E2E_RUN_TOKEN) {
    process.env.E2E_RUN_TOKEN = crypto.randomUUID();
  }

  for (const explicitVar of [
    'E2E_SECOND_BRAIN_DIR',
    'E2E_YOUTUBE_LISTS_DB',
    'E2E_YOUTUBE_LISTS_NOTES_DIR',
  ] as const) {
    if (process.env[explicitVar] !== undefined) {
      assertSafeE2eDataPath(process.env[explicitVar], explicitVar);
    }
  }

  let fixtureRoot = process.env.E2E_RUN_FIXTURE_ROOT;
  if (fixtureRoot !== undefined) {
    fixtureRoot = assertSafeE2eDataPath(fixtureRoot, 'E2E_RUN_FIXTURE_ROOT', {
      requireInsideTmp: true,
    });
  } else if (isStaticMode) {
    fixtureRoot = path.join(os.tmpdir(), `hermes-e2e-static-${process.pid}`);
    process.env.E2E_RUN_FIXTURE_ROOT = fixtureRoot;
  } else {
    fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), `hermes-e2e-run-${process.pid}-`),
    );
    process.env.E2E_RUN_FIXTURE_ROOT = fixtureRoot;
    process.env.E2E_RUN_FIXTURE_OWNER_PID = String(process.pid);
  }

  if (!isStaticMode) {
    const defaultVault = path.join(fixtureRoot, 'vault');
    const defaultNotes = path.join(fixtureRoot, 'yt-notes');
    fs.mkdirSync(defaultVault, { recursive: true });
    fs.mkdirSync(defaultNotes, { recursive: true });
    registerHarnessOwnedVaultRoot(defaultVault);

    if (
      !fixtureExitHookRegistered &&
      process.env.E2E_RUN_FIXTURE_OWNER_PID === String(process.pid)
    ) {
      fixtureExitHookRegistered = true;
      const ownedRootToClean = fixtureRoot;
      process.once('exit', () => {
        try {
          const srvFile = path.join(ownedRootToClean, 'managed-server.json');
          if (fs.existsSync(srvFile)) {
            const srvInfo = JSON.parse(fs.readFileSync(srvFile, 'utf8'));
            if (typeof srvInfo?.pid === 'number' && srvInfo.pid > 1) {
              try {
                process.kill(srvInfo.pid, 'SIGTERM');
              } catch {
                // Ignore if already exited
              }
            }
          }
        } catch {
          // Ignore
        }
        try {
          fs.rmSync(ownedRootToClean, { recursive: true, force: true });
        } catch {
          // Ignore
        }
      });
    }
  }

  return fixtureRoot;
}

function resolveHarnessDataPath(
  e2eVar: 'E2E_SECOND_BRAIN_DIR' | 'E2E_YOUTUBE_LISTS_DB' | 'E2E_YOUTUBE_LISTS_NOTES_DIR',
  plainVar: 'SECOND_BRAIN_DIR' | 'YOUTUBE_LISTS_DB' | 'YOUTUBE_LISTS_NOTES_DIR',
  defaultSubpath: string,
  isVaultRoot = false,
): string {
  const fixtureRoot = ensureRunFixtureEnv();
  const isStaticMode =
    process.argv.includes('--list') ||
    process.argv.includes('--dry-check') ||
    process.env.E2E_STATIC_MODE === '1';

  if (process.env[e2eVar] !== undefined) {
    const validated = assertSafeE2eDataPath(process.env[e2eVar], e2eVar);
    if (
      isVaultRoot &&
      !isStaticMode &&
      isSafeE2eDataPath(validated, { requireInsideTmp: true })
    ) {
      registerHarnessOwnedVaultRoot(validated);
    }
    return validated;
  }

  const plainVal = process.env[plainVar];
  if (
    typeof plainVal === 'string' &&
    plainVal.trim().length > 0 &&
    isSafeE2eDataPath(plainVal, { requireInsideTmp: true })
  ) {
    const validatedPlain = assertSafeE2eDataPath(plainVal, plainVar, {
      requireInsideTmp: true,
    });
    if (isVaultRoot && !isStaticMode) {
      registerHarnessOwnedVaultRoot(validatedPlain);
    }
    return validatedPlain;
  }

  const fallback = assertSafeE2eDataPath(
    path.join(fixtureRoot, defaultSubpath),
    `${e2eVar}(default)`,
    { requireInsideTmp: true },
  );
  if (isVaultRoot && !isStaticMode) {
    registerHarnessOwnedVaultRoot(fallback);
  }
  return fallback;
}

export const E2E_PATHS: E2ePaths = {
  repoRoot: resolvedRepoRoot,
  e2eRoot: resolvedE2eRoot,
  get dataDir(): string {
    return ensureRunFixtureEnv();
  },
  get secondBrainDir(): string {
    return resolveHarnessDataPath(
      'E2E_SECOND_BRAIN_DIR',
      'SECOND_BRAIN_DIR',
      'vault',
      true,
    );
  },
  get youtubeListsDb(): string {
    return resolveHarnessDataPath(
      'E2E_YOUTUBE_LISTS_DB',
      'YOUTUBE_LISTS_DB',
      'youtube-lists.sqlite',
      false,
    );
  },
  get youtubeListsNotesDir(): string {
    return resolveHarnessDataPath(
      'E2E_YOUTUBE_LISTS_NOTES_DIR',
      'YOUTUBE_LISTS_NOTES_DIR',
      'yt-notes',
      false,
    );
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

// Initialize and validate fixture environment on module load
ensureRunFixtureEnv();

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

export function buildDefaultBackendEnv(
  port: string,
  host = '127.0.0.1',
): Record<string, string> {
  ensureRunFixtureEnv();

  if (port === '8880' || port === '8881') {
    throw new Error(
      `[E2E-SAFETY-GUARD] Rule 7: Refusing to bind backend to user preview container port ${port}.`,
    );
  }

  const databaseUrl =
    process.env.DATABASE_URL || 'postgres://hermes:hermes@127.0.0.1:5432/hermes_os';
  if (databaseUrl.includes('hermes_os_preview')) {
    throw new Error(
      `[E2E-SAFETY-GUARD] Rule 7: Refusing to use user preview database "hermes_os_preview".`,
    );
  }

  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  if (/\/2(?:$|\?)/.test(redisUrl)) {
    throw new Error(
      `[E2E-SAFETY-GUARD] Rule 7: Refusing to use user preview Redis DB index 2 (${redisUrl}).`,
    );
  }

  const secondBrainDir = assertSafeE2eDataPath(
    E2E_PATHS.secondBrainDir,
    'SECOND_BRAIN_DIR',
  );
  const youtubeListsDb = assertSafeE2eDataPath(
    E2E_PATHS.youtubeListsDb,
    'YOUTUBE_LISTS_DB',
  );
  const youtubeListsNotesDir = assertSafeE2eDataPath(
    E2E_PATHS.youtubeListsNotesDir,
    'YOUTUBE_LISTS_NOTES_DIR',
  );

  return {
    ...(process.env as Record<string, string>),
    HOST: host,
    HERMES_SERVER_HOST: host,
    PORT: port,
    HERMES_SERVER_PORT: port,
    BIND_ADDR: `${host}:${port}`,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    HERMES_GATEWAY_URL: process.env.HERMES_GATEWAY_URL || 'http://127.0.0.1:8642/v1',
    STATIC_DIST_DIR: E2E_PATHS.webDistDir,
    YOUTUBE_LISTS_DB: youtubeListsDb,
    E2E_YOUTUBE_LISTS_DB: youtubeListsDb,
    YOUTUBE_LISTS_NOTES_DIR: youtubeListsNotesDir,
    E2E_YOUTUBE_LISTS_NOTES_DIR: youtubeListsNotesDir,
    SECOND_BRAIN_DIR: secondBrainDir,
    E2E_SECOND_BRAIN_DIR: secondBrainDir,
    HERMES_E2E_SERVER_TOKEN: process.env.E2E_RUN_TOKEN || '',
    HERMES_ADMIN_USER: process.env.HERMES_ADMIN_USER || 'operator',
    HERMES_ADMIN_PASSWORD: process.env.HERMES_ADMIN_PASSWORD || 'hermes-os-local',
    REQUIRE_WEB_LOGIN: process.env.REQUIRE_WEB_LOGIN || 'false',
  };
}

function getManagedServerStatePath(): string | null {
  const root = process.env.E2E_RUN_FIXTURE_ROOT;
  if (!root) return null;
  return path.join(root, 'managed-server.json');
}

function isVerifiedManagedBackendForCurrentRun(baseUrl: string): boolean {
  if (
    managedBackendChild &&
    managedBackendChild.exitCode === null &&
    managedBackendChild.signalCode === null &&
    managedBackendUrl === baseUrl
  ) {
    return true;
  }

  const statePath = getManagedServerStatePath();
  if (!statePath || !fs.existsSync(statePath)) {
    return false;
  }

  try {
    const info = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const pid = Number(info?.pid);
    const expectedToken = process.env.E2E_RUN_TOKEN || '';
    if (
      !Number.isInteger(pid) ||
      pid <= 1 ||
      info?.baseUrl !== baseUrl ||
      !expectedToken ||
      info?.token !== expectedToken
    ) {
      return false;
    }

    try {
      process.kill(pid, 0);
    } catch {
      return false;
    }

    const procEnvironPath = `/proc/${pid}/environ`;
    if (fs.existsSync(procEnvironPath)) {
      const entries = fs.readFileSync(procEnvironPath, 'utf8').split('\0');
      const envMap = new Map<string, string>();
      for (const entry of entries) {
        const eq = entry.indexOf('=');
        if (eq > 0) {
          envMap.set(entry.slice(0, eq), entry.slice(eq + 1));
        }
      }
      if (envMap.get('HERMES_E2E_SERVER_TOKEN') !== expectedToken) {
        return false;
      }
      assertSafeE2eDataPath(
        envMap.get('SECOND_BRAIN_DIR'),
        'runningServer.SECOND_BRAIN_DIR',
      );
      assertSafeE2eDataPath(
        envMap.get('YOUTUBE_LISTS_DB'),
        'runningServer.YOUTUBE_LISTS_DB',
      );
      assertSafeE2eDataPath(
        envMap.get('YOUTUBE_LISTS_NOTES_DIR'),
        'runningServer.YOUTUBE_LISTS_NOTES_DIR',
      );
    } else {
      assertSafeE2eDataPath(info?.secondBrainDir, 'managedServer.secondBrainDir');
      assertSafeE2eDataPath(info?.youtubeListsDb, 'managedServer.youtubeListsDb');
      assertSafeE2eDataPath(
        info?.youtubeListsNotesDir,
        'managedServer.youtubeListsNotesDir',
      );
    }

    return true;
  } catch {
    return false;
  }
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
  const childEnv = buildDefaultBackendEnv(port, host);
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
    env: childEnv,
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
      const statePath = getManagedServerStatePath();
      if (statePath && fs.existsSync(path.dirname(statePath))) {
        try {
          fs.writeFileSync(
            statePath,
            JSON.stringify(
              {
                pid: child.pid,
                baseUrl,
                token: childEnv.HERMES_E2E_SERVER_TOKEN,
                secondBrainDir: childEnv.SECOND_BRAIN_DIR,
                youtubeListsDb: childEnv.YOUTUBE_LISTS_DB,
                youtubeListsNotesDir: childEnv.YOUTUBE_LISTS_NOTES_DIR,
              },
              null,
              2,
            ),
            'utf8',
          );
        } catch {
          // Ignore state write error
        }
      }
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
  ensureRunFixtureEnv();

  // R2: Validate all resolved data paths BEFORE contacting or starting anything
  assertSafeE2eDataPath(E2E_PATHS.secondBrainDir, 'E2E_PATHS.secondBrainDir');
  assertSafeE2eDataPath(E2E_PATHS.youtubeListsDb, 'E2E_PATHS.youtubeListsDb');
  assertSafeE2eDataPath(
    E2E_PATHS.youtubeListsNotesDir,
    'E2E_PATHS.youtubeListsNotesDir',
  );

  const baseUrl = E2E_URLS.baseUrl;
  const mobileUrl = E2E_URLS.mobileUrl;

  const parsedBase = new URL(baseUrl);
  const parsedMobile = new URL(mobileUrl);
  if (
    parsedBase.port === '8880' ||
    parsedBase.port === '8881' ||
    parsedMobile.port === '8880' ||
    parsedMobile.port === '8881'
  ) {
    throw new Error(
      `[E2E-SAFETY-GUARD] Rule 7: Refusing to target user preview container ports 8880/8881 (baseUrl=${baseUrl}, mobileUrl=${mobileUrl}).`,
    );
  }

  if (await probeHttpOk(`${baseUrl}/api/health`, 2_000)) {
    const canReuse =
      isVerifiedManagedBackendForCurrentRun(baseUrl) ||
      process.env.E2E_ALLOW_EXTERNAL_SERVER === 'true';
    if (!canReuse) {
      throw new Error(
        `[E2E-SAFETY-GUARD] R3: Refusing to reuse unverified server already listening at ${baseUrl}/api/health whose environment the harness cannot vouch for. Stop the existing server on ${baseUrl}, or set E2E_ALLOW_EXTERNAL_SERVER=true if you intentionally started an isolated test server with safe temp paths.`,
      );
    }
  } else {
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
  const statePath = getManagedServerStatePath();
  if (statePath && fs.existsSync(statePath)) {
    try {
      const info = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (typeof info?.pid === 'number' && info.pid > 1) {
        try {
          process.kill(info.pid, 'SIGTERM');
        } catch {
          // Ignore if already dead
        }
      }
    } catch {
      // Ignore
    }
    fs.rmSync(statePath, { force: true });
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
  ensureRunFixtureEnv();

  // R2: Validate any path overrides BEFORE resolving binary, creating temp dirs, or spawning
  for (const key of [
    'SECOND_BRAIN_DIR',
    'E2E_SECOND_BRAIN_DIR',
    'YOUTUBE_LISTS_DB',
    'E2E_YOUTUBE_LISTS_DB',
    'YOUTUBE_LISTS_NOTES_DIR',
    'E2E_YOUTUBE_LISTS_NOTES_DIR',
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      assertSafeE2eDataPath(overrides[key], `withIsolatedBackend.overrides.${key}`);
    }
  }

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
      registerHarnessOwnedVaultRoot(tempVaultDir);
    }

    const mergedEnv: Record<string, string> = {
      ...buildDefaultBackendEnv(portStr, host),
      ...(tempVaultDir ? { SECOND_BRAIN_DIR: tempVaultDir, E2E_SECOND_BRAIN_DIR: tempVaultDir } : {}),
      ...overrides,
      HOST: host,
      HERMES_SERVER_HOST: host,
      PORT: portStr,
      HERMES_SERVER_PORT: portStr,
      BIND_ADDR: `${host}:${portStr}`,
    };

    mergedEnv.SECOND_BRAIN_DIR = assertSafeE2eDataPath(
      mergedEnv.SECOND_BRAIN_DIR,
      'withIsolatedBackend.SECOND_BRAIN_DIR',
    );
    mergedEnv.YOUTUBE_LISTS_DB = assertSafeE2eDataPath(
      mergedEnv.YOUTUBE_LISTS_DB,
      'withIsolatedBackend.YOUTUBE_LISTS_DB',
    );
    mergedEnv.YOUTUBE_LISTS_NOTES_DIR = assertSafeE2eDataPath(
      mergedEnv.YOUTUBE_LISTS_NOTES_DIR,
      'withIsolatedBackend.YOUTUBE_LISTS_NOTES_DIR',
    );

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
