#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const e2eRoot = fs.realpathSync(import.meta.dirname);
const repoRoot = path.resolve(e2eRoot, '..');
const tscCli = path.join(e2eRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const playwrightCli = path.join(e2eRoot, 'node_modules', '@playwright', 'test', 'cli.js');

const ALL_FEATURES = Array.from(
  { length: 36 },
  (_, i) => `F${String(i + 1).padStart(2, '0')}`,
);
const VALID_FEATURE_SET = new Set(ALL_FEATURES);

const PRIMARY_PROTECTED_DATA_ROOT = path.join(repoRoot, 'data');
const VAULT_OWNERSHIP_MARKER_FILE = '.hermes-e2e-vault-root';

function isInsideOrEqual(childPath, parentPath) {
  const c = path.resolve(childPath);
  const p = path.resolve(parentPath);
  if (p === path.sep) return true;
  return c === p || c.startsWith(p + path.sep);
}

function lstatIsSymlink(targetPath) {
  try {
    return fs.lstatSync(targetPath).isSymbolicLink();
  } catch {
    return false;
  }
}

function canonicalizeWithMissingLeaf(absPath, depth = 0) {
  const lexical = path.resolve(absPath);
  if (isInsideOrEqual(lexical, PRIMARY_PROTECTED_DATA_ROOT)) {
    return lexical;
  }
  if (depth > 16) {
    return lexical;
  }

  const tailSegments = [];
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

function getProtectedDataRoots(extraRoots = []) {
  const roots = new Set([PRIMARY_PROTECTED_DATA_ROOT]);
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
    ...extraRoots.map((s) => String(s).trim()).filter(Boolean),
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

function assertSafeE2eDataPath(rawPath, label = 'path', options = {}) {
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
        path.resolve(repoRoot, trimmed),
        path.resolve(e2eRoot, trimmed),
        path.resolve(repoRoot, 'backend', trimmed),
      ];

  const protectedRoots = getProtectedDataRoots(options.extraProtectedRoots || []);
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

  if (options.requireInsideTmp) {
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

function isSafeE2eDataPath(rawPath, options = {}) {
  try {
    assertSafeE2eDataPath(rawPath, 'check', options);
    return true;
  } catch {
    return false;
  }
}

function stampVaultOwnershipMarker(vaultDir) {
  const safePath = assertSafeE2eDataPath(vaultDir, 'vaultDir', { requireInsideTmp: true });
  fs.mkdirSync(safePath, { recursive: true });
  const realRoot = fs.realpathSync(safePath);
  if (
    fs.existsSync(path.join(realRoot, '.git')) ||
    fs.existsSync(path.join(realRoot, '.obsidian'))
  ) {
    throw new Error(
      `[E2E-SAFETY-GUARD] R4: Refusing vault root containing .git or .obsidian: "${realRoot}".`,
    );
  }
  const markerPath = path.join(realRoot, VAULT_OWNERSHIP_MARKER_FILE);
  if (!fs.existsSync(markerPath)) {
    const initialDirs = [];
    const walkDirs = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === VAULT_OWNERSHIP_MARKER_FILE || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          const full = path.join(dir, entry.name);
          initialDirs.push(path.relative(realRoot, full).split(path.sep).join('/'));
          walkDirs(full);
        }
      }
    };
    walkDirs(realRoot);
    fs.writeFileSync(
      markerPath,
      JSON.stringify(
        {
          createdBy: 'hermes-e2e-harness',
          rootRealPath: realRoot,
          runToken: process.env.E2E_RUN_TOKEN || '',
          initialDirs,
        },
        null,
        2,
      ),
      'utf8',
    );
  }
  return realRoot;
}

let runnerFixtureExitRegistered = false;

function ensureRunnerFixtureAndSafetyEnv(opts) {
  const isStaticMode = Boolean(opts.list || opts.dryCheck || opts.help);
  if (isStaticMode) {
    process.env.E2E_STATIC_MODE = '1';
  }

  if (!process.env.E2E_RUN_TOKEN) {
    process.env.E2E_RUN_TOKEN = crypto.randomUUID();
  }

  // R2: Hard guard on any explicit E2E_* override before starting or contacting anything
  for (const explicitVar of [
    'E2E_SECOND_BRAIN_DIR',
    'E2E_YOUTUBE_LISTS_DB',
    'E2E_YOUTUBE_LISTS_NOTES_DIR',
  ]) {
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
    stampVaultOwnershipMarker(defaultVault);

    if (
      !runnerFixtureExitRegistered &&
      process.env.E2E_RUN_FIXTURE_OWNER_PID === String(process.pid)
    ) {
      runnerFixtureExitRegistered = true;
      const rootToClean = fixtureRoot;
      process.once('exit', () => {
        try {
          const srvFile = path.join(rootToClean, 'managed-server.json');
          if (fs.existsSync(srvFile)) {
            const srvInfo = JSON.parse(fs.readFileSync(srvFile, 'utf8'));
            if (typeof srvInfo?.pid === 'number' && srvInfo.pid > 1) {
              try {
                process.kill(srvInfo.pid, 'SIGTERM');
              } catch {
                // Ignore if already dead
              }
            }
          }
        } catch {
          // Ignore
        }
        try {
          fs.rmSync(rootToClean, { recursive: true, force: true });
        } catch {
          // Ignore
        }
      });
    }
  }

  const resolvePair = (e2eVar, plainVar, defaultSubpath, isVault = false) => {
    if (process.env[e2eVar] !== undefined) {
      const validated = assertSafeE2eDataPath(process.env[e2eVar], e2eVar);
      if (isVault && !isStaticMode && isSafeE2eDataPath(validated, { requireInsideTmp: true })) {
        stampVaultOwnershipMarker(validated);
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
      if (isVault && !isStaticMode) {
        stampVaultOwnershipMarker(validatedPlain);
      }
      return validatedPlain;
    }
    const fallback = assertSafeE2eDataPath(
      path.join(fixtureRoot, defaultSubpath),
      `${e2eVar}(default)`,
      { requireInsideTmp: true },
    );
    if (isVault && !isStaticMode) {
      stampVaultOwnershipMarker(fallback);
    }
    return fallback;
  };

  const resolvedSecondBrain = resolvePair(
    'E2E_SECOND_BRAIN_DIR',
    'SECOND_BRAIN_DIR',
    'vault',
    true,
  );
  const resolvedYoutubeDb = resolvePair(
    'E2E_YOUTUBE_LISTS_DB',
    'YOUTUBE_LISTS_DB',
    'youtube-lists.sqlite',
    false,
  );
  const resolvedYoutubeNotes = resolvePair(
    'E2E_YOUTUBE_LISTS_NOTES_DIR',
    'YOUTUBE_LISTS_NOTES_DIR',
    'yt-notes',
    false,
  );

  // Sanitize plain caller env vars in process.env so child processes never inherit unsafe data/ paths
  process.env.SECOND_BRAIN_DIR = resolvedSecondBrain;
  process.env.YOUTUBE_LISTS_DB = resolvedYoutubeDb;
  process.env.YOUTUBE_LISTS_NOTES_DIR = resolvedYoutubeNotes;

  return {
    fixtureRoot,
    secondBrainDir: resolvedSecondBrain,
    youtubeListsDb: resolvedYoutubeDb,
    youtubeListsNotesDir: resolvedYoutubeNotes,
    baseUrl: (process.env.E2E_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, ''),
    mobileUrl: (process.env.E2E_MOBILE_URL || 'http://127.0.0.1:4174').replace(/\/+$/, ''),
  };
}

function printResolvedEnvBanner(envInfo) {
  console.log(
    `[run-e2e] Resolved Harness Environment:\n` +
      `  E2E_RUN_FIXTURE_ROOT    = ${envInfo.fixtureRoot}\n` +
      `  SECOND_BRAIN_DIR        = ${envInfo.secondBrainDir}\n` +
      `  YOUTUBE_LISTS_DB        = ${envInfo.youtubeListsDb}\n` +
      `  YOUTUBE_LISTS_NOTES_DIR = ${envInfo.youtubeListsNotesDir}\n` +
      `  E2E_BASE_URL            = ${envInfo.baseUrl}\n` +
      `  E2E_MOBILE_URL          = ${envInfo.mobileUrl}`,
  );
}

function printUsage() {
  console.log(`Usage: node e2e/run-e2e.mjs [options]

Options:
  (no flags)                  Run full 4-tier suite sequentially (tier1 -> tier2 -> tier3 -> tier4)
  --tier <1|2|3|4>            Restrict execution or discovery to a single tier
  --scope <pattern[,...]>     Scope execution, --list, or --dry-check to matching .spec.ts files or @Fxx tags
  --file <pattern[,...]>      Alias for --scope (restrict to matching .spec.ts files)
  --feature <Fxx[,Fyy...]>    Run/list only tests tagged with @F01..@F36 (safe against describe-title over-match)
  --test-id <ID[,ID...]>      Run/list only tests with bracketed IDs (e.g. T3-08,S12)
  --grep, -g <regex>          Filter tests by title/tag regular expression
  --expect-count <N>          Require pre-flight discovery count to equal N before running
  --print-env                 Print resolved harness fixture paths and exit 0
  --list                      List discovered Playwright specs without starting servers
  --allow-empty               Allow --list to exit 0 when 0 tests are discovered
  --dry-check                 Validate TypeScript (--noEmit), test tags, skip bans & coverage matrix
  --self-test                 Run comprehensive isolated self-tests for CLI & all harness modules
  --help, -h                  Show this help message`);
}

function parseCliArgs(argv) {
  const opts = {
    tier: null,
    list: false,
    allowEmpty: false,
    dryCheck: false,
    scope: null,
    features: [],
    testIds: [],
    grep: null,
    expectCount: null,
    printEnv: false,
    selfTest: false,
    help: false,
  };

  const scopeParts = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--list') {
      opts.list = true;
    } else if (arg === '--allow-empty') {
      opts.allowEmpty = true;
    } else if (arg === '--dry-check') {
      opts.dryCheck = true;
    } else if (arg === '--self-test') {
      opts.selfTest = true;
    } else if (arg === '--print-env') {
      opts.printEnv = true;
    } else if (arg === '--tier' || arg.startsWith('--tier=')) {
      const val = arg === '--tier' ? argv[++i] : arg.slice('--tier='.length);
      if (!val || !/^[1-4]$/.test(val)) {
        console.error(`[run-e2e] Invalid --tier value "${val ?? ''}". Expected 1, 2, 3, or 4.`);
        process.exit(1);
      }
      opts.tier = Number(val);
    } else if (
      arg === '--scope' ||
      arg.startsWith('--scope=') ||
      arg === '--file' ||
      arg.startsWith('--file=')
    ) {
      const eqIdx = arg.indexOf('=');
      const val = eqIdx === -1 ? argv[++i] : arg.slice(eqIdx + 1);
      if (!val || val.trim().length === 0 || val.startsWith('--')) {
        console.error(`[run-e2e] Missing pattern after ${eqIdx === -1 ? arg : arg.slice(0, eqIdx)}.`);
        process.exit(1);
      }
      scopeParts.push(val.trim());
    } else if (arg === '--feature' || arg.startsWith('--feature=')) {
      const val = arg === '--feature' ? argv[++i] : arg.slice('--feature='.length);
      if (!val || val.trim().length === 0 || val.startsWith('--')) {
        console.error(`[run-e2e] Missing feature ID(s) after --feature.`);
        process.exit(1);
      }
      const tokens = val
        .split(/[,|\s]+/)
        .map((t) => t.trim().replace(/^@/, '').toUpperCase())
        .filter(Boolean);
      if (tokens.length === 0) {
        console.error(`[run-e2e] Empty --feature value.`);
        process.exit(1);
      }
      for (const tok of tokens) {
        if (!VALID_FEATURE_SET.has(tok)) {
          console.error(
            `[run-e2e] Invalid --feature tag "${tok}". Expected zero-padded F01..F36.`,
          );
          process.exit(1);
        }
        if (!opts.features.includes(tok)) {
          opts.features.push(tok);
        }
      }
    } else if (arg === '--test-id' || arg.startsWith('--test-id=')) {
      const val = arg === '--test-id' ? argv[++i] : arg.slice('--test-id='.length);
      if (!val || val.trim().length === 0 || val.startsWith('--')) {
        console.error(`[run-e2e] Missing test ID(s) after --test-id.`);
        process.exit(1);
      }
      const tokens = val
        .split(/[,|\s]+/)
        .map((t) => t.trim().replace(/^\[|\]$/g, ''))
        .filter(Boolean);
      if (tokens.length === 0) {
        console.error(`[run-e2e] Empty --test-id value.`);
        process.exit(1);
      }
      for (const tok of tokens) {
        if (!/^(?:T[1-4]|T3-\d{2}|S\d{2}|F\d{2})$/i.test(tok)) {
          console.error(
            `[run-e2e] Invalid --test-id "${tok}". Expected IDs like T3-08, S12, or F14.`,
          );
          process.exit(1);
        }
        const upper = tok.toUpperCase();
        if (!opts.testIds.includes(upper)) {
          opts.testIds.push(upper);
        }
      }
    } else if (arg === '--grep' || arg === '-g' || arg.startsWith('--grep=')) {
      const val =
        arg === '--grep' || arg === '-g' ? argv[++i] : arg.slice('--grep='.length);
      if (!val || val.trim().length === 0) {
        console.error(`[run-e2e] Missing pattern after --grep.`);
        process.exit(1);
      }
      try {
        new RegExp(val);
      } catch (err) {
        console.error(`[run-e2e] Invalid --grep regular expression "${val}": ${String(err)}`);
        process.exit(1);
      }
      opts.grep = val;
    } else if (arg === '--expect-count' || arg.startsWith('--expect-count=')) {
      const val =
        arg === '--expect-count' ? argv[++i] : arg.slice('--expect-count='.length);
      if (!val || !/^\d+$/.test(val)) {
        console.error(`[run-e2e] Invalid --expect-count "${val ?? ''}". Expected non-negative integer.`);
        process.exit(1);
      }
      opts.expectCount = Number(val);
    } else {
      console.error(`[run-e2e] Unknown CLI argument: "${arg}"`);
      printUsage();
      process.exit(1);
    }
  }

  if (scopeParts.length > 0) {
    opts.scope = scopeParts.join(',');
  }

  return opts;
}

function runNodeSubprocess(scriptPath, args, options = {}) {
  const { cwd = e2eRoot, env = {}, quiet = false } = options;
  const childEnv = {
    ...process.env,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    ...env,
  };
  for (const [k, v] of Object.entries(childEnv)) {
    if (v === undefined) {
      delete childEnv[k];
    }
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      env: childEnv,
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });

    let stdout = '';
    let stderr = '';
    if (quiet) {
      child.stdout?.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
    }

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
    child.on('error', (err) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${String(err)}`,
      });
    });
  });
}

async function invokePlaywrightWithJsonReport(
  pwArgs,
  extraEnv = {},
  quiet = false,
  options = {},
) {
  const { ephemeralOutputDir = false } = options;
  const reportPath = path.join(
    os.tmpdir(),
    `hermes-e2e-report-${process.pid}-${crypto.randomUUID()}.json`,
  );
  const tempOutputDir =
    ephemeralOutputDir && !process.env.E2E_OUTPUT_DIR && !extraEnv.E2E_OUTPUT_DIR
      ? path.join(os.tmpdir(), `hermes-e2e-pwout-${process.pid}-${crypto.randomUUID()}`)
      : null;

  try {
    const { exitCode, stdout, stderr } = await runNodeSubprocess(
      playwrightCli,
      ['test', ...pwArgs, '--reporter=json'],
      {
        cwd: e2eRoot,
        env: {
          ...(tempOutputDir ? { E2E_OUTPUT_DIR: tempOutputDir } : {}),
          ...extraEnv,
          PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
        },
        quiet,
      },
    );

    let report = null;
    if (fs.existsSync(reportPath)) {
      try {
        report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      } catch {
        report = null;
      }
    }

    return { exitCode, report, stdout, stderr };
  } finally {
    fs.rmSync(reportPath, { force: true });
    if (tempOutputDir) {
      fs.rmSync(tempOutputDir, { recursive: true, force: true });
    }
  }
}

function flattenDiscoveredSpecs(report) {
  const collected = [];
  if (!report || !Array.isArray(report.suites)) {
    return collected;
  }

  const walkSuite = (suite, parentFile = '') => {
    const suiteFile = suite.file || parentFile;
    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        collected.push({
          spec,
          fileFromSuite: suiteFile,
        });
      }
    }
    if (Array.isArray(suite.suites)) {
      for (const child of suite.suites) {
        walkSuite(child, suiteFile);
      }
    }
  };

  for (const rootSuite of report.suites) {
    walkSuite(rootSuite, rootSuite.file || '');
  }

  return collected;
}

function auditDiscoveredSpec(spec, fileFromSuite) {
  const errors = [];
  const posixFile = String(spec.file || fileFromSuite || '').replace(/\\/g, '/');
  const loc = `${posixFile}:${spec.line ?? 0} ("${spec.title}")`;

  let expectedTier = null;
  const dirMatch = posixFile.match(/(?:^|\/)tier([1-4])\//);
  if (dirMatch) {
    expectedTier = Number(dirMatch[1]);
  } else {
    const projMatch = String(spec.tests?.[0]?.projectName || '').match(/^tier([1-4])$/);
    if (projMatch) {
      expectedTier = Number(projMatch[1]);
    }
  }

  if (!expectedTier) {
    errors.push(`${loc}: spec file must reside under tier1/, tier2/, tier3/, or tier4/`);
    return { errors, tier: null, features: [] };
  }

  if (!Array.isArray(spec.tests) || spec.tests.length === 0) {
    errors.push(`${loc}: spec registered 0 runnable test entries`);
  } else {
    if (spec.tests.some((t) => t.expectedStatus !== 'passed')) {
      const nonPassing = [
        ...new Set(spec.tests.map((t) => t.expectedStatus).filter((s) => s !== 'passed')),
      ];
      errors.push(
        `${loc}: non-passing expectedStatus [${nonPassing.join(', ')}] is forbidden (test.skip / test.fixme / test.fail are banned)`,
      );
    }
    const forbiddenAnnTypes = [];
    for (const t of spec.tests) {
      if (Array.isArray(t.annotations)) {
        for (const a of t.annotations) {
          const at = String(a?.type || '').toLowerCase();
          if (['skip', 'fixme', 'fail'].includes(at)) {
            forbiddenAnnTypes.push(at);
          }
        }
      }
    }
    if (forbiddenAnnTypes.length > 0) {
      errors.push(
        `${loc}: forbidden test annotation(s) [${[...new Set(forbiddenAnnTypes)].join(', ')}]`,
      );
    }
  }

  const normalizedTags = (spec.tags || []).map((t) => (t.startsWith('@') ? t : `@${t}`));

  const tierCandidateTags = normalizedTags.filter((t) => /^@tier/i.test(t));
  const validTierTags = [];
  for (const t of tierCandidateTags) {
    const m = t.match(/^@tier([1-4])$/);
    if (!m) {
      errors.push(`${loc}: invalid tier tag "${t}" (expected @tier1..@tier4)`);
    } else {
      validTierTags.push(Number(m[1]));
    }
  }
  const uniqueTiers = [...new Set(validTierTags)];
  if (uniqueTiers.length !== 1 || uniqueTiers[0] !== expectedTier) {
    errors.push(
      `${loc}: expected exact tag @tier${expectedTier} matching directory tier${expectedTier}/, got [${tierCandidateTags.join(', ')}]`,
    );
  }

  const featureCandidateTags = normalizedTags.filter((t) => /^@f\d+$/i.test(t));
  const validFeatures = [];
  for (const t of featureCandidateTags) {
    const fid = t.slice(1);
    if (!VALID_FEATURE_SET.has(fid)) {
      errors.push(
        `${loc}: invalid feature tag "${t}" (must be zero-padded uppercase @F01..@F36)`,
      );
    } else {
      validFeatures.push(fid);
    }
  }

  const distinctFeatures = [...new Set(validFeatures)];
  const minFeatures = expectedTier === 3 ? 2 : 1;
  if (distinctFeatures.length < minFeatures) {
    errors.push(
      `${loc}: Tier ${expectedTier} test requires >= ${minFeatures} distinct @F01..@F36 tag(s), got [${distinctFeatures.map((f) => `@${f}`).join(', ')}]`,
    );
  }

  return { errors, tier: expectedTier, features: distinctFeatures };
}

const FORBIDDEN_PW_MODIFIERS = new Set(['skip', 'fixme', 'fail', 'only']);

function unwrapAstExpr(expr) {
  let cur = expr;
  while (
    cur &&
    (ts.isParenthesizedExpression(cur) ||
      ts.isNonNullExpression(cur) ||
      ts.isAsExpression(cur) ||
      (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(cur)))
  ) {
    cur = cur.expression;
  }
  return cur;
}

function getStaticPropertyName(node) {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    const arg = unwrapAstExpr(node.argumentExpression);
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
      return arg.text;
    }
  }
  return null;
}

function resolveBindingElementPropName(element) {
  if (!element.propertyName) {
    return ts.isIdentifier(element.name) ? element.name.text : null;
  }
  if (
    ts.isIdentifier(element.propertyName) ||
    ts.isStringLiteral(element.propertyName) ||
    ts.isNoSubstitutionTemplateLiteral(element.propertyName)
  ) {
    return element.propertyName.text;
  }
  if (ts.isComputedPropertyName(element.propertyName)) {
    const ce = unwrapAstExpr(element.propertyName.expression);
    if (ce && (ts.isStringLiteral(ce) || ts.isNoSubstitutionTemplateLiteral(ce))) {
      return ce.text;
    }
  }
  return null;
}

function cloneAstState(state) {
  return {
    testIds: new Set(state.testIds),
    describeIds: new Set(state.describeIds),
    stepIds: new Set(state.stepIds),
    testInfoIds: new Set(state.testInfoIds),
    testInfoFnIds: new Set(state.testInfoFnIds),
    pwNsIds: new Set(state.pwNsIds),
    forbiddenCallIds: new Set(state.forbiddenCallIds),
  };
}

function removeShadowedIdentifier(state, idName) {
  state.testIds.delete(idName);
  state.describeIds.delete(idName);
  state.stepIds.delete(idName);
  state.testInfoIds.delete(idName);
  state.testInfoFnIds.delete(idName);
  state.pwNsIds.delete(idName);
  state.forbiddenCallIds.delete(idName);
}

function collectBoundIdentifiers(bindingName, out = []) {
  if (!bindingName) return out;
  if (ts.isIdentifier(bindingName)) {
    out.push(bindingName.text);
  } else if (ts.isObjectBindingPattern(bindingName) || ts.isArrayBindingPattern(bindingName)) {
    for (const el of bindingName.elements) {
      if (ts.isBindingElement(el)) {
        collectBoundIdentifiers(el.name, out);
      }
    }
  }
  return out;
}

function classifyPlaywrightTarget(rawExpr, state) {
  const expr = unwrapAstExpr(rawExpr);
  if (!expr) return null;

  if (ts.isIdentifier(expr)) {
    if (state.testIds.has(expr.text)) return 'test';
    if (state.describeIds.has(expr.text)) return 'test.describe';
    if (state.stepIds.has(expr.text)) return 'test.step';
    if (state.testInfoIds.has(expr.text)) return 'testInfo';
    if (state.testInfoFnIds.has(expr.text)) return 'test.info';
    if (state.pwNsIds.has(expr.text)) return 'pwNs';
    if (state.forbiddenCallIds.has(expr.text)) return 'forbiddenCall';
    return null;
  }

  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
    const prop = getStaticPropertyName(expr);
    const base = unwrapAstExpr(expr.expression);
    const baseKind = classifyPlaywrightTarget(base, state);

    if (baseKind === 'pwNs') {
      if (prop === 'test' || prop === 'default') return 'test';
      if (prop === 'describe') return 'test.describe';
      if (prop === 'step') return 'test.step';
      if (prop === 'info') return 'test.info';
      if (prop && FORBIDDEN_PW_MODIFIERS.has(prop)) return 'forbiddenCall';
      return null;
    }

    if (baseKind === 'test' || baseKind === 'test.describe') {
      if (prop === 'describe' || prop === 'parallel' || prop === 'serial') {
        return 'test.describe';
      }
      if (prop === 'step') {
        return 'test.step';
      }
      if (prop === 'info') {
        return 'test.info';
      }
      if (prop && FORBIDDEN_PW_MODIFIERS.has(prop)) {
        return 'forbiddenCall';
      }
      return null;
    }

    if (baseKind === 'test.step' || baseKind === 'testInfo' || baseKind === 'test.info()') {
      if (baseKind === 'test.step' && prop === 'step') {
        return 'test.step';
      }
      if (prop && FORBIDDEN_PW_MODIFIERS.has(prop)) {
        return 'forbiddenCall';
      }
      return null;
    }

    return null;
  }

  if (ts.isCallExpression(expr)) {
    const callee = unwrapAstExpr(expr.expression);
    const calleeKind = classifyPlaywrightTarget(callee, state);
    if (calleeKind === 'test.info') {
      return 'test.info()';
    }
    if (callee && (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))) {
      const prop = getStaticPropertyName(callee);
      const baseKind = classifyPlaywrightTarget(callee.expression, state);
      if (baseKind === 'test' && prop === 'info') {
        return 'test.info()';
      }
      if (baseKind === 'test' && prop === 'extend') {
        return 'test';
      }
    }
    return null;
  }

  return null;
}

function classifyPlaywrightCallbackRegistrationCall(callNode, state) {
  const callee = unwrapAstExpr(callNode.expression);
  if (!callee) return null;
  const directKind = classifyPlaywrightTarget(callee, state);
  if (directKind === 'test') return 'test';
  if (directKind === 'test.step') return 'step';

  if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
    const prop = getStaticPropertyName(callee);
    const baseKind = classifyPlaywrightTarget(callee.expression, state);
    if (baseKind === 'test.step' && (prop === 'step' || FORBIDDEN_PW_MODIFIERS.has(prop || ''))) {
      return 'step';
    }
    if (baseKind === 'test' || baseKind === 'test.describe') {
      if (prop === 'step') return 'step';
      if (
        prop === 'beforeEach' ||
        prop === 'afterEach' ||
        prop === 'beforeAll' ||
        prop === 'afterAll' ||
        FORBIDDEN_PW_MODIFIERS.has(prop || '')
      ) {
        return 'test';
      }
    }
  }
  return null;
}

function auditSpecFileAst(absFilePath, displayPath) {
  const errors = [];
  let src = '';
  try {
    src = fs.readFileSync(absFilePath, 'utf8');
  } catch (err) {
    errors.push(`${displayPath}:1: failed to read spec file for AST audit: ${String(err)}`);
    return errors;
  }

  const sourceFile = ts.createSourceFile(
    absFilePath,
    src,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const formatLoc = (node) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return `${displayPath}:${line + 1}`;
  };

  const bindFromObjectPattern = (bindingPattern, sourceKind, currentState) => {
    for (const el of bindingPattern.elements) {
      const propText = resolveBindingElementPropName(el);
      if (!propText) continue;

      if (sourceKind === 'pwNs') {
        if (propText === 'test' || propText === 'default') {
          if (ts.isIdentifier(el.name)) {
            currentState.testIds.add(el.name.text);
          } else if (ts.isObjectBindingPattern(el.name)) {
            bindFromObjectPattern(el.name, 'test', currentState);
          }
        } else if (propText === 'describe') {
          if (ts.isIdentifier(el.name)) {
            currentState.describeIds.add(el.name.text);
          } else if (ts.isObjectBindingPattern(el.name)) {
            bindFromObjectPattern(el.name, 'test.describe', currentState);
          }
        } else if (propText === 'step') {
          if (ts.isIdentifier(el.name)) {
            currentState.stepIds.add(el.name.text);
          } else if (ts.isObjectBindingPattern(el.name)) {
            bindFromObjectPattern(el.name, 'test.step', currentState);
          }
        } else if (propText === 'info') {
          if (ts.isIdentifier(el.name)) {
            currentState.testInfoFnIds.add(el.name.text);
          } else if (ts.isObjectBindingPattern(el.name)) {
            bindFromObjectPattern(el.name, 'test.info()', currentState);
          }
        } else if (FORBIDDEN_PW_MODIFIERS.has(propText)) {
          errors.push(
            `${formatLoc(el)}: forbidden .skip/.fixme/.fail/.only usage (destructured "${propText}" from ${sourceKind})`,
          );
          if (ts.isIdentifier(el.name)) {
            currentState.forbiddenCallIds.add(el.name.text);
          }
        }
        continue;
      }

      if (FORBIDDEN_PW_MODIFIERS.has(propText)) {
        errors.push(
          `${formatLoc(el)}: forbidden .skip/.fixme/.fail/.only usage (destructured "${propText}" from ${sourceKind})`,
        );
        if (ts.isIdentifier(el.name)) {
          currentState.forbiddenCallIds.add(el.name.text);
        }
        continue;
      }

      if (
        (sourceKind === 'test' || sourceKind === 'test.describe') &&
        (propText === 'describe' || propText === 'parallel' || propText === 'serial')
      ) {
        if (ts.isIdentifier(el.name)) {
          currentState.describeIds.add(el.name.text);
        } else if (ts.isObjectBindingPattern(el.name)) {
          bindFromObjectPattern(el.name, 'test.describe', currentState);
        }
      } else if (sourceKind === 'test' && propText === 'step') {
        if (ts.isIdentifier(el.name)) {
          currentState.stepIds.add(el.name.text);
        } else if (ts.isObjectBindingPattern(el.name)) {
          bindFromObjectPattern(el.name, 'test.step', currentState);
        }
      } else if (sourceKind === 'test' && propText === 'info') {
        if (ts.isIdentifier(el.name)) {
          currentState.testInfoFnIds.add(el.name.text);
        } else if (ts.isObjectBindingPattern(el.name)) {
          bindFromObjectPattern(el.name, 'test.info()', currentState);
        }
      }
    }
  };

  const rootState = {
    testIds: new Set(['test']),
    describeIds: new Set(),
    stepIds: new Set(),
    testInfoIds: new Set(['testInfo']),
    testInfoFnIds: new Set(),
    pwNsIds: new Set(),
    forbiddenCallIds: new Set(),
  };

  const visit = (node, state, testCallbackFnNodes, stepCallbackFnNodes) => {
    let currentState = state;

    if (ts.isBlock(node)) {
      currentState = cloneAstState(state);
    }

    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node)
    ) {
      currentState = cloneAstState(state);

      for (const param of node.parameters) {
        for (const idName of collectBoundIdentifiers(param.name)) {
          removeShadowedIdentifier(currentState, idName);
        }
      }

      if (testCallbackFnNodes.has(node) && node.parameters.length >= 2) {
        const secondParam = node.parameters[1];
        if (ts.isIdentifier(secondParam.name)) {
          currentState.testInfoIds.add(secondParam.name.text);
        } else if (ts.isObjectBindingPattern(secondParam.name)) {
          bindFromObjectPattern(secondParam.name, 'testInfo', currentState);
        }
      }

      if (stepCallbackFnNodes.has(node) && node.parameters.length >= 1) {
        const firstParam = node.parameters[0];
        if (ts.isIdentifier(firstParam.name)) {
          currentState.stepIds.add(firstParam.name.text);
        } else if (ts.isObjectBindingPattern(firstParam.name)) {
          bindFromObjectPattern(firstParam.name, 'test.step', currentState);
        }
      }

      for (const param of node.parameters) {
        const typeText = param.type ? param.type.getText(sourceFile) : '';
        if (/\b(TestInfo|TestStepInfo)\b/.test(typeText)) {
          if (ts.isIdentifier(param.name)) {
            currentState.testInfoIds.add(param.name.text);
          } else if (ts.isObjectBindingPattern(param.name)) {
            bindFromObjectPattern(param.name, 'TestInfo', currentState);
          }
        }
      }
    }

    if (ts.isImportDeclaration(node) && node.importClause) {
      const modSpec = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '';
      const isPlaywrightMod = modSpec.includes('playwright');
      if (node.importClause.name && ts.isIdentifier(node.importClause.name) && isPlaywrightMod) {
        currentState.testIds.add(node.importClause.name.text);
      }
      const bindings = node.importClause.namedBindings;
      if (bindings) {
        if (ts.isNamespaceImport(bindings) && isPlaywrightMod) {
          currentState.pwNsIds.add(bindings.name.text);
        } else if (ts.isNamedImports(bindings)) {
          for (const spec of bindings.elements) {
            const imported = (spec.propertyName || spec.name).text;
            const local = spec.name.text;
            removeShadowedIdentifier(currentState, local);
            if (imported === 'test' || (imported === 'default' && isPlaywrightMod)) {
              currentState.testIds.add(local);
            } else if (imported === 'describe' && isPlaywrightMod) {
              currentState.describeIds.add(local);
            } else if (imported === 'step' && isPlaywrightMod) {
              currentState.stepIds.add(local);
            } else if (imported === 'info' && isPlaywrightMod) {
              currentState.testInfoFnIds.add(local);
            } else if (FORBIDDEN_PW_MODIFIERS.has(imported) && isPlaywrightMod) {
              errors.push(
                `${formatLoc(spec)}: forbidden .skip/.fixme/.fail/.only import "${imported}" from ${modSpec}`,
              );
              currentState.forbiddenCallIds.add(local);
            }
          }
        }
      }
    }

    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initKind = classifyPlaywrightTarget(node.initializer, currentState);
      for (const idName of collectBoundIdentifiers(node.name)) {
        removeShadowedIdentifier(currentState, idName);
      }
      if (initKind) {
        if (ts.isIdentifier(node.name)) {
          if (initKind === 'test') {
            currentState.testIds.add(node.name.text);
          } else if (initKind === 'test.describe') {
            currentState.describeIds.add(node.name.text);
          } else if (initKind === 'test.step') {
            currentState.stepIds.add(node.name.text);
          } else if (initKind === 'test.info') {
            currentState.testInfoFnIds.add(node.name.text);
          } else if (initKind === 'test.info()' || initKind === 'testInfo') {
            currentState.testInfoIds.add(node.name.text);
          } else if (initKind === 'pwNs') {
            currentState.pwNsIds.add(node.name.text);
          } else if (initKind === 'forbiddenCall') {
            currentState.forbiddenCallIds.add(node.name.text);
          }
        } else if (ts.isObjectBindingPattern(node.name)) {
          bindFromObjectPattern(node.name, initKind, currentState);
        }
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const prop = getStaticPropertyName(node);
      const targetKind = classifyPlaywrightTarget(node.expression, currentState);
      const isTrackedPlaywrightObj =
        targetKind === 'test' ||
        targetKind === 'test.describe' ||
        targetKind === 'test.step' ||
        targetKind === 'testInfo' ||
        targetKind === 'test.info()' ||
        targetKind === 'pwNs';

      if (prop && FORBIDDEN_PW_MODIFIERS.has(prop) && isTrackedPlaywrightObj) {
        errors.push(
          `${formatLoc(node)}: forbidden .skip/.fixme/.fail/.only usage (${targetKind}.${prop})`,
        );
      } else if (ts.isElementAccessExpression(node) && prop === null && isTrackedPlaywrightObj) {
        errors.push(
          `${formatLoc(node)}: forbidden dynamic element access on ${targetKind}`,
        );
      }
    }

    if (ts.isCallExpression(node)) {
      const calleeExpr = unwrapAstExpr(node.expression);
      if (calleeExpr && ts.isIdentifier(calleeExpr) && currentState.forbiddenCallIds.has(calleeExpr.text)) {
        errors.push(
          `${formatLoc(node)}: forbidden call to aliased .skip/.fixme/.fail/.only identifier "${calleeExpr.text}()"`,
        );
      }

      const regKind = classifyPlaywrightCallbackRegistrationCall(node, currentState);
      if (regKind === 'test' || regKind === 'step') {
        for (const arg of node.arguments) {
          const unwrapped = unwrapAstExpr(arg);
          if (unwrapped && (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped))) {
            if (regKind === 'step') {
              stepCallbackFnNodes.add(unwrapped);
            } else {
              testCallbackFnNodes.add(unwrapped);
            }
          }
        }
      }
    }

    ts.forEachChild(node, (child) =>
      visit(child, currentState, testCallbackFnNodes, stepCallbackFnNodes),
    );
  };

  visit(sourceFile, rootState, new WeakSet(), new WeakSet());
  return errors;
}

function collectFilesRecursive(dirPath, predicate) {
  const out = [];
  if (!fs.existsSync(dirPath)) return out;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const abs = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFilesRecursive(abs, predicate));
    } else if (predicate(abs, entry.name)) {
      out.push(abs);
    }
  }
  return out.sort();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchScopedSpecFiles(testRootDir, scopePattern, tierFilter = null) {
  const allSpecs = collectFilesRecursive(testRootDir, (_abs, name) => name.endsWith('.spec.ts'));
  let rawScope = scopePattern.replace(/\\/g, '/');

  if (path.isAbsolute(scopePattern)) {
    const resolvedScopePosix = path.resolve(scopePattern).split(path.sep).join('/');
    const candidatePrefixes = [
      testRootDir,
      fs.existsSync(testRootDir) ? fs.realpathSync(testRootDir) : null,
      path.join(e2eRoot, 'tests'),
      e2eRoot,
      repoRoot,
    ]
      .filter(Boolean)
      .map((p) => p.split(path.sep).join('/').replace(/\/+$/, '') + '/');

    for (const candidateInput of [rawScope, resolvedScopePosix]) {
      let stripped = false;
      for (const prefix of candidatePrefixes) {
        if (candidateInput.startsWith(prefix)) {
          rawScope = candidateInput.slice(prefix.length);
          stripped = true;
          break;
        }
      }
      if (stripped) break;
    }
  }

  const normScope = rawScope
    .replace(/^\.\//, '')
    .replace(/^e2e\//, '')
    .replace(/^tests\//, '');

  const hasGlobMeta = /[*?[\]{}]/.test(normScope);
  const unstrippedAbsolute = path.isAbsolute(scopePattern) && normScope.startsWith('/');

  return allSpecs.filter((absPath) => {
    const absPosix = absPath.split(path.sep).join('/');
    const relToTests = path.relative(testRootDir, absPath).split(path.sep).join('/');
    const relToE2e = `tests/${relToTests}`;
    const baseName = path.basename(absPath);

    if (tierFilter !== null && !relToTests.startsWith(`tier${tierFilter}/`)) {
      return false;
    }

    if (unstrippedAbsolute) {
      return hasGlobMeta ? path.matchesGlob(absPosix, normScope) : absPosix === normScope;
    }

    if (hasGlobMeta) {
      return (
        path.matchesGlob(relToTests, normScope) ||
        path.matchesGlob(relToE2e, rawScope) ||
        path.matchesGlob(baseName, normScope)
      );
    }

    return (
      relToTests === normScope ||
      relToTests.startsWith(normScope) ||
      relToE2e.startsWith(rawScope.replace(/^\.\//, '')) ||
      baseName === normScope ||
      baseName.startsWith(normScope) ||
      path.matchesGlob(relToTests, `**/${normScope}*`)
    );
  });
}

function buildTempTsconfigPayload(tsFiles) {
  const harnessFiles = collectFilesRecursive(
    path.join(e2eRoot, 'harness'),
    (_abs, name) => name.endsWith('.ts'),
  );
  return {
    extends: path.join(e2eRoot, 'tsconfig.json'),
    compilerOptions: {
      noEmit: true,
      types: ['node'],
      typeRoots: [path.join(e2eRoot, 'node_modules', '@types')],
      baseUrl: e2eRoot,
      paths: {
        '@playwright/test': [
          path.join(e2eRoot, 'node_modules', '@playwright', 'test', 'index.d.ts'),
        ],
      },
    },
    files: [path.join(e2eRoot, 'playwright.config.ts'), ...harnessFiles, ...tsFiles],
    include: [],
    exclude: [],
  };
}

function resolveScopeAndFilterOptions(opts, testRootDir, isDryCheck = false) {
  const features = [...(opts.features || [])];
  const testIds = [...(opts.testIds || [])];
  let matchedFiles = null;

  if (opts.scope) {
    const rawTokens = opts.scope
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (rawTokens.length === 0) {
      return {
        ok: false,
        error: `Empty --scope value "${opts.scope}".`,
      };
    }

    const fileSet = new Set();
    for (const tok of rawTokens) {
      const filesForTok = matchScopedSpecFiles(testRootDir, tok, opts.tier);
      if (filesForTok.length > 0) {
        for (const f of filesForTok) {
          fileSet.add(f);
        }
        continue;
      }

      if (!isDryCheck) {
        const featMatch = tok.match(/^@?(F\d{2})$/i);
        if (featMatch && VALID_FEATURE_SET.has(featMatch[1].toUpperCase())) {
          const fid = featMatch[1].toUpperCase();
          if (!features.includes(fid)) {
            features.push(fid);
          }
          continue;
        }
        const idMatch = tok.match(/^\[?(T3-\d{2}|S\d{2})\]?$/i);
        if (idMatch) {
          const tid = idMatch[1].toUpperCase();
          if (!testIds.includes(tid)) {
            testIds.push(tid);
          }
          continue;
        }
      }

      return {
        ok: false,
        error: `--scope token "${tok}" matched 0 .spec.ts files under ${testRootDir}.`,
      };
    }

    if (fileSet.size > 0) {
      matchedFiles = Array.from(fileSet).sort();
    }
  }

  const grepParts = [];
  if (features.length > 0) {
    grepParts.push(`@(?:${features.join('|')})(?!\\d)`);
  }
  if (testIds.length > 0) {
    grepParts.push(`\\[(?:${testIds.map(escapeRegex).join('|')})\\]`);
  }
  if (opts.grep !== null) {
    grepParts.push(opts.grep);
  }

  let compiledGrep = null;
  if (grepParts.length === 1) {
    compiledGrep = grepParts[0];
  } else if (grepParts.length > 1) {
    compiledGrep = `^(?:${grepParts.map((p) => `(?=.*(?:${p}))`).join('')}).*$`;
  }

  const hasScopeOrFilter = Boolean(
    matchedFiles !== null || compiledGrep !== null || opts.scope,
  );

  return {
    ok: true,
    hasScopeOrFilter,
    matchedFiles,
    compiledGrep,
    features,
    testIds,
  };
}

async function handleListMode(opts) {
  const testRootDir = process.env.E2E_TEST_DIR
    ? path.resolve(e2eRoot, process.env.E2E_TEST_DIR)
    : path.join(e2eRoot, 'tests');

  const resolved = resolveScopeAndFilterOptions(opts, testRootDir, false);
  if (!resolved.ok) {
    console.error(`[run-e2e] ERROR: ${resolved.error}`);
    return 1;
  }

  const pwArgs = [];
  if (resolved.matchedFiles && resolved.matchedFiles.length > 0) {
    for (const abs of resolved.matchedFiles) {
      pwArgs.push(`${escapeRegex(abs.split(path.sep).join('/'))}$`);
    }
  }
  if (opts.tier !== null) {
    pwArgs.push(`--project=tier${opts.tier}`);
  }
  if (resolved.compiledGrep !== null) {
    pwArgs.push('--grep', resolved.compiledGrep);
  }
  pwArgs.push('--list', '--pass-with-no-tests');

  const { exitCode, report } = await invokePlaywrightWithJsonReport(pwArgs, {}, false, {
    ephemeralOutputDir: true,
  });
  const loadErrors = Array.isArray(report?.errors) ? report.errors.length : 0;
  const discovered = flattenDiscoveredSpecs(report);

  if (exitCode !== 0 || loadErrors > 0) {
    console.error(
      `[run-e2e] --list failed (playwrightExit=${exitCode}, loadErrors=${loadErrors}).`,
    );
    return 1;
  }

  if (opts.expectCount !== null && discovered.length !== opts.expectCount) {
    console.error(
      `[run-e2e] ERROR: Expected ${opts.expectCount} test(s) (--expect-count), but discovered ${discovered.length}.`,
    );
    return 1;
  }

  if (discovered.length === 0) {
    if (opts.allowEmpty) {
      console.log(
        `[run-e2e] 0 tests discovered${opts.tier ? ` in tier${opts.tier}` : ''} (--allow-empty enabled).`,
      );
      return 0;
    }
    console.error(
      `[run-e2e] ERROR: 0 tests discovered${opts.tier ? ` in tier${opts.tier}` : ''}. Pass --allow-empty only when empty discovery is expected.`,
    );
    return 1;
  }

  console.log(
    `[run-e2e] Listed ${discovered.length} test(s)${opts.tier ? ` in tier${opts.tier}` : ''} with 0 load errors.`,
  );
  return 0;
}

async function handleScopedDryCheck(opts) {
  const testRootDir = process.env.E2E_TEST_DIR
    ? path.resolve(e2eRoot, process.env.E2E_TEST_DIR)
    : path.join(e2eRoot, 'tests');

  const resolved = resolveScopeAndFilterOptions(opts, testRootDir, true);
  if (!resolved.ok || !resolved.matchedFiles || resolved.matchedFiles.length === 0) {
    console.error(
      `[run-e2e] Scoped --dry-check matched 0 .spec.ts files for --scope "${opts.scope}" under ${testRootDir}.`,
    );
    return 1;
  }
  const matchedSpecAbsPaths = resolved.matchedFiles;

  const tmpTsconfigPath = path.join(
    os.tmpdir(),
    `hermes-e2e-tsconfig-${process.pid}-${crypto.randomUUID()}.json`,
  );

  try {
    const tsconfigPayload = buildTempTsconfigPayload(matchedSpecAbsPaths);
    fs.writeFileSync(tmpTsconfigPath, JSON.stringify(tsconfigPayload, null, 2), 'utf8');

    console.log(
      `[run-e2e] Typechecking ${matchedSpecAbsPaths.length} scoped spec file(s) + harness...`,
    );
    const tscRes = await runNodeSubprocess(tscCli, [
      '--project',
      tmpTsconfigPath,
      '--noEmit',
    ]);
    if (tscRes.exitCode !== 0) {
      console.error(`[run-e2e] Scoped tsc --noEmit failed.`);
      return 1;
    }

    const astErrors = [];
    for (const absSpec of matchedSpecAbsPaths) {
      const relPosix = path.relative(testRootDir, absSpec).split(path.sep).join('/');
      if (!/^tier[1-4]\//.test(relPosix)) {
        astErrors.push(
          `${relPosix}: spec file must reside under tier1/, tier2/, tier3/, or tier4/`,
        );
      }
      astErrors.push(...auditSpecFileAst(absSpec, relPosix));
    }

    const escapedFileArgs = matchedSpecAbsPaths.map(
      (abs) => `${escapeRegex(abs.split(path.sep).join('/'))}$`,
    );
    const pwArgs = [...escapedFileArgs];
    if (opts.tier !== null) {
      pwArgs.push(`--project=tier${opts.tier}`);
    }
    pwArgs.push('--list');

    const { exitCode: pwExit, report } = await invokePlaywrightWithJsonReport(
      pwArgs,
      {},
      false,
      { ephemeralOutputDir: true },
    );
    const loadErrors = Array.isArray(report?.errors) ? report.errors.length : 0;
    const discovered = flattenDiscoveredSpecs(report);

    if (pwExit !== 0 || loadErrors > 0 || discovered.length === 0) {
      if (astErrors.length > 0) {
        for (const err of astErrors) {
          console.error(`  - ${err}`);
        }
      }
      console.error(
        `[run-e2e] Scoped Playwright discovery failed (exit=${pwExit}, loadErrors=${loadErrors}, discovered=${discovered.length}).`,
      );
      return 1;
    }

    const validationErrors = [...astErrors];
    for (const { spec, fileFromSuite } of discovered) {
      const { errors } = auditDiscoveredSpec(spec, fileFromSuite);
      validationErrors.push(...errors);
    }

    if (validationErrors.length > 0) {
      console.error(
        `[run-e2e] Scoped tag/skip validation failed (${validationErrors.length} error(s)):`,
      );
      for (const err of validationErrors) {
        console.error(`  - ${err}`);
      }
      return 1;
    }

    console.log(
      `[run-e2e] Scoped --dry-check PASSED (${matchedSpecAbsPaths.length} file(s), ${discovered.length} test(s)).`,
    );
    return 0;
  } finally {
    fs.rmSync(tmpTsconfigPath, { force: true });
  }
}

async function handleUnscopedDryCheck() {
  const defaultTestsDir = path.join(e2eRoot, 'tests');
  const testRootDir = process.env.E2E_TEST_DIR
    ? path.resolve(e2eRoot, process.env.E2E_TEST_DIR)
    : defaultTestsDir;
  const usesCustomTestDir = path.resolve(testRootDir) !== path.resolve(defaultTestsDir);
  const tmpTsconfigPath = usesCustomTestDir
    ? path.join(os.tmpdir(), `hermes-e2e-tsconfig-${process.pid}-${crypto.randomUUID()}.json`)
    : null;

  try {
    console.log(`[run-e2e] Running full TypeScript check (tsc --noEmit)...`);
    let tsconfigProjectPath = path.join(e2eRoot, 'tsconfig.json');
    if (tmpTsconfigPath) {
      const allTsFilesInTestRootDir = collectFilesRecursive(testRootDir, (_abs, name) =>
        name.endsWith('.ts'),
      );
      const tsconfigPayload = buildTempTsconfigPayload(allTsFilesInTestRootDir);
      fs.writeFileSync(tmpTsconfigPath, JSON.stringify(tsconfigPayload, null, 2), 'utf8');
      tsconfigProjectPath = tmpTsconfigPath;
    }

    const tscRes = await runNodeSubprocess(tscCli, [
      '--project',
      tsconfigProjectPath,
      '--noEmit',
    ]);
    if (tscRes.exitCode !== 0) {
      console.error(`[run-e2e] Full tsc --noEmit failed.`);
      return 1;
    }

    const validationErrors = [];
    const allSpecFilesOnDisk = collectFilesRecursive(testRootDir, (_abs, name) =>
      name.endsWith('.spec.ts'),
    );
    for (const absSpec of allSpecFilesOnDisk) {
      const relPosix = path.relative(testRootDir, absSpec).split(path.sep).join('/');
      if (!/^tier[1-4]\//.test(relPosix)) {
        validationErrors.push(
          `${relPosix}: spec file must reside under tier1/, tier2/, tier3/, or tier4/`,
        );
      }
      validationErrors.push(...auditSpecFileAst(absSpec, relPosix));
    }

    console.log(`[run-e2e] Running full Playwright test discovery...`);
    const { exitCode: pwExit, report } = await invokePlaywrightWithJsonReport(
      ['--list', '--pass-with-no-tests'],
      {},
      false,
      { ephemeralOutputDir: true },
    );
    const loadErrors = Array.isArray(report?.errors) ? report.errors.length : 0;
    if (pwExit !== 0 || loadErrors > 0) {
      console.error(
        `[run-e2e] Playwright discovery failed (exit=${pwExit}, loadErrors=${loadErrors}).`,
      );
      return 1;
    }

    const discovered = flattenDiscoveredSpecs(report);

    const tierTotals = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const tier1ByFeature = Object.fromEntries(ALL_FEATURES.map((f) => [f, 0]));
    const tier2ByFeature = Object.fromEntries(ALL_FEATURES.map((f) => [f, 0]));
    const tier3ByFeature = Object.fromEntries(ALL_FEATURES.map((f) => [f, 0]));

    for (const { spec, fileFromSuite } of discovered) {
      const { errors, tier, features } = auditDiscoveredSpec(spec, fileFromSuite);
      validationErrors.push(...errors);
      if (tier) {
        tierTotals[tier] += 1;
        for (const fid of features) {
          if (tier === 1) tier1ByFeature[fid] += 1;
          if (tier === 2) tier2ByFeature[fid] += 1;
          if (tier === 3) tier3ByFeature[fid] += 1;
        }
      }
    }

    for (const fid of ALL_FEATURES) {
      if (tier1ByFeature[fid] < 5) {
        validationErrors.push(
          `Coverage threshold failed: ${fid} has ${tier1ByFeature[fid]} Tier 1 test(s) (required >= 5)`,
        );
      }
      if (tier2ByFeature[fid] < 5) {
        validationErrors.push(
          `Coverage threshold failed: ${fid} has ${tier2ByFeature[fid]} Tier 2 test(s) (required >= 5)`,
        );
      }
      if (tier3ByFeature[fid] < 1) {
        validationErrors.push(
          `Coverage threshold failed: ${fid} appears in 0 Tier 3 pairwise tests (required >= 1)`,
        );
      }
    }

    if (tierTotals[1] < 180) {
      validationErrors.push(
        `Tier 1 total count is ${tierTotals[1]} (required >= 180)`,
      );
    }
    if (tierTotals[2] < 180) {
      validationErrors.push(
        `Tier 2 total count is ${tierTotals[2]} (required >= 180)`,
      );
    }
    if (tierTotals[3] < 36) {
      validationErrors.push(
        `Tier 3 total count is ${tierTotals[3]} (required >= 36)`,
      );
    }
    if (tierTotals[4] < 18) {
      validationErrors.push(
        `Tier 4 total count is ${tierTotals[4]} (required >= 18)`,
      );
    }

    // Verify data/ zero-tracking privacy invariant
    try {
      const trackedData = execFileSync('git', ['ls-files', 'data/'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim();
      if (trackedData.length > 0) {
        validationErrors.push(
          `Privacy check failed: git ls-files data/ is non-empty:\n${trackedData}`,
        );
      }
      const statusDataLines = execFileSync('git', ['status', '--porcelain', 'data/'], {
        cwd: repoRoot,
        encoding: 'utf8',
      })
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('D '));
      if (statusDataLines.length > 0) {
        validationErrors.push(
          `Privacy check failed: git status --porcelain data/ reported staged/untracked entries:\n${statusDataLines.join('\n')}`,
        );
      }
    } catch (err) {
      validationErrors.push(`Failed to run git privacy check on data/: ${String(err)}`);
    }

    console.log(
      `[run-e2e] Discovered counts: T1=${tierTotals[1]}, T2=${tierTotals[2]}, T3=${tierTotals[3]}, T4=${tierTotals[4]}, Total=${discovered.length}`,
    );

    if (validationErrors.length > 0) {
      console.error(
        `[run-e2e] Unscoped --dry-check FAILED with ${validationErrors.length} violation(s):`,
      );
      for (const err of validationErrors.slice(0, 50)) {
        console.error(`  - ${err}`);
      }
      if (validationErrors.length > 50) {
        console.error(`  ... and ${validationErrors.length - 50} more violation(s).`);
      }
      return 1;
    }

    console.log(`[run-e2e] Full --dry-check PASSED (${discovered.length} total tests, 0 data/ files tracked).`);
    return 0;
  } finally {
    if (tmpTsconfigPath) {
      fs.rmSync(tmpTsconfigPath, { force: true });
    }
  }
}

function hasForbiddenAnnotation(annotations) {
  return (
    Array.isArray(annotations) &&
    annotations.some((a) =>
      ['skip', 'fixme', 'fail'].includes(String(a?.type || '').toLowerCase()),
    )
  );
}

function findStepProblem(steps) {
  if (!Array.isArray(steps)) return null;
  for (const s of steps) {
    if (!s || typeof s !== 'object') continue;
    if (s.error) {
      return `step "${s.title || '<unnamed>'}" reported an error`;
    }
    if (String(s.category || '').toLowerCase() === 'skip') {
      return `step "${s.title || '<unnamed>'}" has category="skip"`;
    }
    if (hasForbiddenAnnotation(s.annotations)) {
      return `step "${s.title || '<unnamed>'}" has forbidden skip/fixme/fail annotation`;
    }
    if (
      /^\s*(?:skip|fixme)\b|\bskipped\b/i.test(String(s.title || '')) &&
      (s.category === 'test.step' || Array.isArray(s.annotations))
    ) {
      return `step "${s.title || '<unnamed>'}" indicates skipped/fixme step`;
    }
    const nested = findStepProblem(s.steps);
    if (nested) return nested;
  }
  return null;
}

async function runPreflightSelectionCheck(testRootDir, opts, resolved) {
  const pwArgs = [];
  if (resolved.matchedFiles && resolved.matchedFiles.length > 0) {
    for (const abs of resolved.matchedFiles) {
      pwArgs.push(`${escapeRegex(abs.split(path.sep).join('/'))}$`);
    }
  }
  if (opts.tier !== null) {
    pwArgs.push(`--project=tier${opts.tier}`);
  }
  if (resolved.compiledGrep !== null) {
    pwArgs.push('--grep', resolved.compiledGrep);
  }
  pwArgs.push('--list', '--pass-with-no-tests');

  const { exitCode, report } = await invokePlaywrightWithJsonReport(pwArgs, {}, true, {
    ephemeralOutputDir: true,
  });
  const loadErrors = Array.isArray(report?.errors) ? report.errors.length : 0;
  const discovered = flattenDiscoveredSpecs(report);

  if (exitCode !== 0 || loadErrors > 0) {
    return {
      ok: false,
      error: `Pre-flight discovery failed (exit=${exitCode}, loadErrors=${loadErrors}).`,
    };
  }

  const byTier = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const { spec, fileFromSuite } of discovered) {
    const posixFile = String(spec.file || fileFromSuite || '').replace(/\\/g, '/');
    const dirMatch = posixFile.match(/(?:^|\/)tier([1-4])\//);
    const projMatch = String(spec.tests?.[0]?.projectName || '').match(/^tier([1-4])$/);
    const tier = dirMatch
      ? Number(dirMatch[1])
      : projMatch
        ? Number(projMatch[1])
        : null;
    if (tier && byTier[tier] !== undefined) {
      byTier[tier] += 1;
    }
  }

  const activeTiers = [1, 2, 3, 4].filter((t) => byTier[t] > 0);
  console.log(
    `[run-e2e] Pre-flight selection: ${discovered.length} test(s) across tier(s) [${activeTiers.map((t) => `tier${t}:${byTier[t]}`).join(', ')}]`,
  );

  if (discovered.length === 0) {
    return {
      ok: false,
      error: `Scope/filter matched 0 tests. Refusing to run empty suite.`,
    };
  }

  if (opts.expectCount !== null && discovered.length !== opts.expectCount) {
    return {
      ok: false,
      error: `Expected ${opts.expectCount} matched test(s) (--expect-count), but pre-flight found ${discovered.length}.`,
    };
  }

  return {
    ok: true,
    totalCount: discovered.length,
    byTier,
    activeTiers,
  };
}

async function runSingleTierLive(
  tierNum,
  tierScopedFiles = null,
  compiledGrep = null,
) {
  console.log(`\n[run-e2e] === Executing Tier ${tierNum} (project=tier${tierNum}) ===`);
  const testRootDir = process.env.E2E_TEST_DIR
    ? path.resolve(e2eRoot, process.env.E2E_TEST_DIR)
    : path.join(e2eRoot, 'tests');
  const tierDir = path.join(testRootDir, `tier${tierNum}`);

  const pwArgs = [];
  if (Array.isArray(tierScopedFiles) && tierScopedFiles.length > 0) {
    for (const abs of tierScopedFiles) {
      pwArgs.push(`${escapeRegex(abs.split(path.sep).join('/'))}$`);
    }
  }
  pwArgs.push(`--project=tier${tierNum}`);
  if (compiledGrep !== null) {
    pwArgs.push('--grep', compiledGrep);
  }
  pwArgs.push('--pass-with-no-tests');

  const { exitCode, report } = await invokePlaywrightWithJsonReport(pwArgs);

  const loadErrors = Array.isArray(report?.errors) ? report.errors.length : 0;
  const stats = report?.stats || {};
  const expected = Number(stats.expected || 0);
  const unexpected = Number(stats.unexpected || 0);
  const flaky = Number(stats.flaky || 0);
  const skipped = Number(stats.skipped || 0);
  const total = expected + unexpected + flaky + skipped;

  const discovered = flattenDiscoveredSpecs(report);
  const specIntegrityViolations = [];
  let genuinelyPassed = 0;

  const auditedSpecAbsPaths = new Set();
  const tierSpecFiles =
    Array.isArray(tierScopedFiles) && tierScopedFiles.length > 0
      ? tierScopedFiles
      : collectFilesRecursive(tierDir, (_abs, name) => name.endsWith('.spec.ts'));
  for (const absSpec of tierSpecFiles) {
    auditedSpecAbsPaths.add(absSpec);
    const relPosix = path.relative(testRootDir, absSpec).split(path.sep).join('/');
    specIntegrityViolations.push(...auditSpecFileAst(absSpec, relPosix));
  }

  for (const { spec, fileFromSuite } of discovered) {
    const rawFile = spec.file || fileFromSuite || '';
    if (rawFile) {
      const candidateAbs = path.isAbsolute(rawFile) ? rawFile : path.resolve(testRootDir, rawFile);
      if (fs.existsSync(candidateAbs) && !auditedSpecAbsPaths.has(candidateAbs)) {
        auditedSpecAbsPaths.add(candidateAbs);
        const relPosix = path.relative(testRootDir, candidateAbs).split(path.sep).join('/');
        specIntegrityViolations.push(...auditSpecFileAst(candidateAbs, relPosix));
      }
    }

    const loc = `${rawFile || '<unknown>'}:${spec.line ?? 0} ("${spec.title}")`;
    if (!Array.isArray(spec.tests) || spec.tests.length === 0) {
      specIntegrityViolations.push(`${loc}: spec contains 0 test entries`);
      continue;
    }
    for (const t of spec.tests) {
      if (t.expectedStatus !== 'passed') {
        specIntegrityViolations.push(
          `${loc}: forbidden expectedStatus="${t.expectedStatus}" (test.fail / test.skip / test.fixme are banned)`,
        );
        continue;
      }
      if (hasForbiddenAnnotation(t.annotations)) {
        specIntegrityViolations.push(
          `${loc}: test has forbidden skip/fixme/fail annotation`,
        );
        continue;
      }
      if (!Array.isArray(t.results) || t.results.length === 0) {
        specIntegrityViolations.push(`${loc}: test produced 0 execution results`);
        continue;
      }
      let resultClean = true;
      for (const r of t.results) {
        if (r.status !== 'passed') {
          specIntegrityViolations.push(
            `${loc}: result status="${r.status}" (expected "passed")`,
          );
          resultClean = false;
          break;
        }
        if (hasForbiddenAnnotation(r.annotations)) {
          specIntegrityViolations.push(
            `${loc}: result has forbidden skip/fixme/fail annotation`,
          );
          resultClean = false;
          break;
        }
        const stepProblem = findStepProblem(r.steps);
        if (stepProblem) {
          specIntegrityViolations.push(`${loc}: ${stepProblem}`);
          resultClean = false;
          break;
        }
      }
      if (!resultClean) {
        continue;
      }
      genuinelyPassed += 1;
    }
  }

  console.log(
    `[run-e2e] Tier ${tierNum} summary: total=${total}, passed=${genuinelyPassed}, failed=${unexpected}, flaky=${flaky}, skipped=${skipped}, loadErrors=${loadErrors}, integrityViolations=${specIntegrityViolations.length}`,
  );
  for (const v of specIntegrityViolations) {
    console.error(`  - [integrity] ${v}`);
  }

  const tierPassed =
    exitCode === 0 &&
    loadErrors === 0 &&
    discovered.length > 0 &&
    total > 0 &&
    genuinelyPassed === total &&
    expected === total &&
    unexpected === 0 &&
    flaky === 0 &&
    skipped === 0 &&
    specIntegrityViolations.length === 0;

  return {
    tierNum,
    exitCode,
    loadErrors,
    total,
    passed: genuinelyPassed,
    expected,
    unexpected,
    flaky,
    skipped,
    specIntegrityViolations,
    tierPassed,
  };
}

async function handleSingleTierMode(tierNum, opts, envInfo) {
  const testRootDir = process.env.E2E_TEST_DIR
    ? path.resolve(e2eRoot, process.env.E2E_TEST_DIR)
    : path.join(e2eRoot, 'tests');

  const resolved = resolveScopeAndFilterOptions(opts, testRootDir, false);
  if (!resolved.ok) {
    console.error(`[run-e2e] ERROR: ${resolved.error}`);
    return 1;
  }

  printResolvedEnvBanner(envInfo);

  let tierScopedFiles = null;
  if (resolved.matchedFiles) {
    tierScopedFiles = resolved.matchedFiles.filter((abs) => {
      const relPosix = path.relative(testRootDir, abs).split(path.sep).join('/');
      return relPosix.startsWith(`tier${tierNum}/`);
    });
    if (tierScopedFiles.length === 0) {
      console.error(
        `[run-e2e] ERROR: Scope matched 0 spec files in tier${tierNum}.`,
      );
      return 1;
    }
  }

  if (resolved.hasScopeOrFilter || opts.expectCount !== null) {
    const preflight = await runPreflightSelectionCheck(testRootDir, opts, resolved);
    if (!preflight.ok) {
      console.error(`[run-e2e] ERROR: ${preflight.error}`);
      return 1;
    }
  }

  const res = await runSingleTierLive(
    tierNum,
    tierScopedFiles,
    resolved.compiledGrep,
  );

  if (!res.tierPassed) {
    console.error(
      `[run-e2e] Tier ${tierNum} FAILED (requires > 0 tests and 100% genuine pass with 0 skipped/flaky/expected-fail/loadErrors).`,
    );
    return 1;
  }

  console.log(`[run-e2e] Tier ${tierNum} PASSED (${res.passed}/${res.total}).`);
  return 0;
}

async function handleFullSuiteMode(opts, envInfo) {
  const testRootDir = process.env.E2E_TEST_DIR
    ? path.resolve(e2eRoot, process.env.E2E_TEST_DIR)
    : path.join(e2eRoot, 'tests');

  const resolved = resolveScopeAndFilterOptions(opts, testRootDir, false);
  if (!resolved.ok) {
    console.error(`[run-e2e] ERROR: ${resolved.error}`);
    return 1;
  }

  printResolvedEnvBanner(envInfo);

  let tiersToExecute = [1, 2, 3, 4];
  if (resolved.hasScopeOrFilter || opts.expectCount !== null) {
    const preflight = await runPreflightSelectionCheck(testRootDir, opts, resolved);
    if (!preflight.ok) {
      console.error(`[run-e2e] ERROR: ${preflight.error}`);
      return 1;
    }
    if (resolved.hasScopeOrFilter) {
      tiersToExecute = preflight.activeTiers;
    }
  }

  const tierResults = [];
  let grandTotal = 0;
  let grandPassed = 0;
  let grandUnexpected = 0;
  let grandFlaky = 0;
  let grandSkipped = 0;
  let grandLoadErrors = 0;
  let grandIntegrityViolations = 0;

  for (const tierNum of tiersToExecute) {
    const tierScopedFiles = resolved.matchedFiles
      ? resolved.matchedFiles.filter((abs) => {
          const relPosix = path.relative(testRootDir, abs).split(path.sep).join('/');
          return relPosix.startsWith(`tier${tierNum}/`);
        })
      : null;

    if (tierScopedFiles !== null && tierScopedFiles.length === 0) {
      continue;
    }

    const res = await runSingleTierLive(
      tierNum,
      tierScopedFiles,
      resolved.compiledGrep,
    );
    tierResults.push(res);
    grandTotal += res.total;
    grandPassed += res.passed;
    grandUnexpected += res.unexpected;
    grandFlaky += res.flaky;
    grandSkipped += res.skipped;
    grandLoadErrors += res.loadErrors;
    grandIntegrityViolations += res.specIntegrityViolations.length;
  }

  console.log(
    `\n[run-e2e] === Grand Suite Summary: total=${grandTotal}, passed=${grandPassed}, failed=${grandUnexpected}, flaky=${grandFlaky}, skipped=${grandSkipped}, loadErrors=${grandLoadErrors}, integrityViolations=${grandIntegrityViolations} ===`,
  );

  if (!resolved.hasScopeOrFilter) {
    const emptyTiers = tierResults.filter((r) => r.total === 0).map((r) => `tier${r.tierNum}`);
    if (emptyTiers.length > 0) {
      console.error(
        `[run-e2e] Full suite FAILED: empty tier(s) [${emptyTiers.join(', ')}] (every tier 1..4 must execute > 0 tests).`,
      );
      return 1;
    }
  } else if (tierResults.length === 0 || grandTotal === 0) {
    console.error(`[run-e2e] Scoped suite FAILED: 0 tests executed.`);
    return 1;
  }

  const everyTierPassedCleanly = tierResults.every(
    (r) =>
      r.total > 0 &&
      r.passed === r.total &&
      r.tierPassed &&
      r.unexpected === 0 &&
      r.flaky === 0 &&
      r.skipped === 0 &&
      r.loadErrors === 0 &&
      r.specIntegrityViolations.length === 0,
  );

  if (!everyTierPassedCleanly || grandTotal <= 0 || grandPassed !== grandTotal) {
    console.error(
      `[run-e2e] Suite FAILED (requires > 0 tests and 100% genuine pass with 0 skipped/flaky/expected-fail/loadErrors).`,
    );
    return 1;
  }

  console.log(`[run-e2e] Suite PASSED (${grandPassed}/${grandTotal}).`);
  return 0;
}

function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('No address')));
        return;
      }
      const p = addr.port;
      srv.close((err) => (err ? reject(err) : resolve(p)));
    });
  });
}

async function handleSelfTest() {
  const tmpSelfDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `hermes-e2e-selftest-${process.pid}-`),
  );
  const runnerScript = path.join(e2eRoot, 'run-e2e.mjs');

  try {
    console.log(`[self-test] Created isolated workspace at ${tmpSelfDir}`);

    fs.writeFileSync(
      path.join(tmpSelfDir, 'package.json'),
      JSON.stringify({ name: 'hermes-e2e-selftest-tmp', private: true, type: 'module' }, null, 2),
      'utf8',
    );
    fs.symlinkSync(path.join(e2eRoot, 'node_modules'), path.join(tmpSelfDir, 'node_modules'));
    fs.symlinkSync(path.join(e2eRoot, 'harness'), path.join(tmpSelfDir, 'harness'));

    const emptyTestsDir = path.join(tmpSelfDir, 'empty-tests');
    const goodTestsDir = path.join(tmpSelfDir, 'tests');
    const badTestsDir = path.join(tmpSelfDir, 'bad-tests');
    const outDir = path.join(tmpSelfDir, 'test-results');

    for (const root of [emptyTestsDir, goodTestsDir, badTestsDir]) {
      for (const t of ['tier1', 'tier2', 'tier3', 'tier4']) {
        fs.mkdirSync(path.join(root, t), { recursive: true });
      }
    }

    // 1. Mock backend executable for env.ts ensureStackReady & withIsolatedBackend
    const mockBackendPath = path.join(tmpSelfDir, 'mock-backend.mjs');
    fs.writeFileSync(
      mockBackendPath,
      `#!/usr/bin/env node
import http from 'node:http';
const port = Number(process.env.PORT || '18080');
const host = process.env.HOST || '127.0.0.1';
const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      status: 'ok',
      db_online: true,
      redis_online: true,
      hermes_gateway: 'offline_mock',
      isolated_marker: process.env.TEST_ISOLATED_MARKER || null,
      second_brain_dir: process.env.SECOND_BRAIN_DIR || null,
      youtube_lists_db: process.env.YOUTUBE_LISTS_DB || null,
      youtube_lists_notes_dir: process.env.YOUTUBE_LISTS_NOTES_DIR || null,
    }));
    return;
  }
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'not_found' }));
});
server.listen(port, host);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`,
      { encoding: 'utf8', mode: 0o755 },
    );
    fs.chmodSync(mockBackendPath, 0o755);

    // 2. Mock mobile dist bundle with index.html + real WASM magic header (\0asm\x01\0\0\0)
    const mobileDistDir = path.join(tmpSelfDir, 'mobile-dist');
    fs.mkdirSync(mobileDistDir, { recursive: true });
    fs.writeFileSync(
      path.join(mobileDistDir, 'index.html'),
      '<!doctype html><html><head><title>HERMES Companion</title></head><body><main id="mobile-root">ROUTINES | TODOS | COMPANION</main></body></html>',
      'utf8',
    );
    fs.writeFileSync(
      path.join(mobileDistDir, 'sql-wasm.wasm'),
      Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
    );

    // 3. Stage A: Empty directory CLI flag checks
    console.log(`[self-test] Stage A: Verifying --list / --allow-empty / --tier 1 on empty dir...`);
    const emptyAllowRes = await runNodeSubprocess(
      runnerScript,
      ['--list', '--allow-empty'],
      { env: { E2E_TEST_DIR: emptyTestsDir, E2E_OUTPUT_DIR: outDir }, quiet: true },
    );
    if (emptyAllowRes.exitCode !== 0) {
      throw new Error(
        `Expected --list --allow-empty on empty dir to exit 0, got ${emptyAllowRes.exitCode}:\n${emptyAllowRes.stderr}`,
      );
    }

    const emptyNoAllowRes = await runNodeSubprocess(
      runnerScript,
      ['--list'],
      { env: { E2E_TEST_DIR: emptyTestsDir, E2E_OUTPUT_DIR: outDir }, quiet: true },
    );
    if (emptyNoAllowRes.exitCode !== 1) {
      throw new Error(
        `Expected --list WITHOUT --allow-empty on empty dir to exit 1, got ${emptyNoAllowRes.exitCode}`,
      );
    }

    const emptyTierLiveRes = await runNodeSubprocess(
      runnerScript,
      ['--tier', '1'],
      { env: { E2E_TEST_DIR: emptyTestsDir, E2E_OUTPUT_DIR: outDir }, quiet: true },
    );
    if (emptyTierLiveRes.exitCode !== 1) {
      throw new Error(
        `Expected --tier 1 on empty dir to exit 1, got ${emptyTierLiveRes.exitCode}`,
      );
    }

    // 4. Write negative tag/skip specs in badTestsDir
    fs.writeFileSync(
      path.join(badTestsDir, 'tier1', 'missing-feature.spec.ts'),
      `import { test, expect } from '@playwright/test';
test('missing feature tag', { tag: ['@tier1'] }, async () => {
  expect(1 + 1).toBe(2);
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier3', 'single-feature-t3.spec.ts'),
      `import { test, expect } from '@playwright/test';
test('tier3 with only one feature tag', { tag: ['@tier3', '@F01'] }, async () => {
  expect(1 + 1).toBe(2);
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier2', 'skipped-spec.spec.ts'),
      `import { test, expect } from '@playwright/test';
test.skip('static skip forbidden', { tag: ['@tier2', '@F02'] }, async () => {
  expect(1 + 1).toBe(2);
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier1', 'expected-fail-trap.spec.ts'),
      `import { test, expect } from '@playwright/test';
test.fail('[T1][F01] expected fail trap', { tag: ['@tier1', '@F01'] }, async () => {
  expect(1).toBe(2);
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier1', 'runtime-test-info-skip.spec.ts'),
      `import { test, expect } from '@playwright/test';
test('[T1][F01] runtime test.info().skip() trap', { tag: ['@tier1', '@F01'] }, async () => {
  test.info().skip();
  expect(1).toBe(1);
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier1', 'runtime-cond-skip.spec.ts'),
      `import { test, expect } from '@playwright/test';
test('[T1][F01] runtime conditional test.skip trap', { tag: ['@tier1', '@F01'] }, async () => {
  test.skip(Boolean(1), 'dynamic skip');
  expect(1).toBe(1);
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier1', 'runtime-param-skip.spec.ts'),
      `import { test, expect } from '@playwright/test';
test('[T1][F01] callback 2nd param skip trap', { tag: ['@tier1', '@F01'] }, async ({ request: _r }, info) => {
  info.skip();
  expect(1).toBe(1);
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier1', 'runtime-destructured-skip.spec.ts'),
      `import { test, expect } from '@playwright/test';
test('[T1][F01] destructured testInfo skip trap', { tag: ['@tier1', '@F01'] }, async ({ request: _r }, { skip }) => {
  skip();
  expect(1).toBe(1);
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier1', 'runtime-bracket-only.spec.ts'),
      `import { test, expect } from '@playwright/test';
test['only']('[T1][F01] bracket only trap', { tag: ['@tier1', '@F01'] }, async () => {
  expect(1).toBe(1);
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier1', 'step-static-skip.spec.ts'),
      `import { test, expect } from '@playwright/test';
test('[T1][F01] test.step.skip trap', { tag: ['@tier1', '@F01'] }, async () => {
  await test.step.skip('skipped step', async () => {
    expect(1).toBe(2);
  });
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier1', 'step-callback-skip.spec.ts'),
      `import { test, expect } from '@playwright/test';
test('[T1][F01] step callback skip trap', { tag: ['@tier1', '@F01'] }, async () => {
  await test.step('step callback', async (step) => {
    step.skip(true, 'skip step');
    expect(1).toBe(2);
  });
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier1', 'default-import-skip.spec.ts'),
      `import pwTest, { expect } from '@playwright/test';
pwTest('[T1][F01] default import skip trap', { tag: ['@tier1', '@F01'] }, async () => {
  pwTest.info().skip();
  expect(1).toBe(1);
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier1', 'named-default-import-skip.spec.ts'),
      `import { default as it, expect } from '@playwright/test';
it('[T1][F01] named default import skip trap', { tag: ['@tier1', '@F01'] }, async () => {
  it.skip(true, 'no');
  expect(1).toBe(1);
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier1', 'destructured-info-fn-skip.spec.ts'),
      `import { test, expect } from '@playwright/test';
const { info } = test;
test('[T1][F01] destructured info() skip trap', { tag: ['@tier1', '@F01'] }, async () => {
  info().skip();
  expect(1).toBe(1);
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier1', 'computed-destructure-test-skip.spec.ts'),
      `import { test, expect } from '@playwright/test';
const { ['skip']: s } = test;
test('[T1][F01] computed destructuring test skip trap', { tag: ['@tier1', '@F01'] }, async () => {
  s();
  expect(1).toBe(1);
});
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(badTestsDir, 'tier1', 'computed-destructure-testinfo-skip.spec.ts'),
      `import { test, expect } from '@playwright/test';
test('[T1][F01] computed destructuring testInfo skip trap', { tag: ['@tier1', '@F01'] }, async ({}, ti) => {
  const { [\`skip\`]: s } = ti;
  s();
  expect(1).toBe(1);
});
`,
      'utf8',
    );

    console.log(`[self-test] Stage B: Verifying negative --scope ... --dry-check & live trap rejections...`);
    for (const badScope of [
      'missing-feature',
      'single-feature-t3',
      'skipped-spec',
      'expected-fail-trap',
      'runtime-test-info-skip',
      'runtime-cond-skip',
      'runtime-param-skip',
      'runtime-destructured-skip',
      'runtime-bracket-only',
      'step-static-skip',
      'step-callback-skip',
      'default-import-skip',
      'named-default-import-skip',
      'destructured-info-fn-skip',
      'computed-destructure-test-skip',
      'computed-destructure-testinfo-skip',
    ]) {
      const badRes = await runNodeSubprocess(
        runnerScript,
        ['--scope', badScope, '--dry-check'],
        { env: { E2E_TEST_DIR: badTestsDir, E2E_OUTPUT_DIR: outDir }, quiet: true },
      );
      if (badRes.exitCode !== 1) {
        throw new Error(
          `Expected negative --scope ${badScope} --dry-check to exit 1, got ${badRes.exitCode}`,
        );
      }
    }

    // Verify live --tier 1 ALSO rejects test.fail(...) AND step.skip(...) traps!
    const liveFailTrapDir = path.join(tmpSelfDir, 'live-fail-trap-tests');
    for (const t of ['tier1', 'tier2', 'tier3', 'tier4']) {
      fs.mkdirSync(path.join(liveFailTrapDir, t), { recursive: true });
    }
    fs.copyFileSync(
      path.join(badTestsDir, 'tier1', 'expected-fail-trap.spec.ts'),
      path.join(liveFailTrapDir, 'tier1', 'expected-fail-trap.spec.ts'),
    );
    const liveExpectedFailRes = await runNodeSubprocess(
      runnerScript,
      ['--tier', '1'],
      { env: { E2E_TEST_DIR: liveFailTrapDir, E2E_OUTPUT_DIR: outDir }, quiet: true },
    );
    if (liveExpectedFailRes.exitCode !== 1) {
      throw new Error(
        `Expected live --tier 1 on test.fail(...) trap to exit 1, got ${liveExpectedFailRes.exitCode}`,
      );
    }

    const liveStepSkipTrapDir = path.join(tmpSelfDir, 'live-step-skip-trap-tests');
    for (const t of ['tier1', 'tier2', 'tier3', 'tier4']) {
      fs.mkdirSync(path.join(liveStepSkipTrapDir, t), { recursive: true });
    }
    fs.writeFileSync(
      path.join(liveStepSkipTrapDir, 'tier1', 'live-step-skip.spec.ts'),
      `import { test, expect } from '@playwright/test';
test('[T1][F01] live step skip trap', { tag: ['@tier1', '@F01'] }, async () => {
  await test.step('sub', async (step) => {
    step.skip(true, 'inner');
  });
  expect(1).toBe(1);
});
`,
      'utf8',
    );
    const liveStepSkipRes = await runNodeSubprocess(
      runnerScript,
      ['--tier', '1'],
      { env: { E2E_TEST_DIR: liveStepSkipTrapDir, E2E_OUTPUT_DIR: outDir }, quiet: true },
    );
    if (liveStepSkipRes.exitCode !== 1) {
      throw new Error(
        `Expected live --tier 1 on runtime step.skip(...) trap to exit 1, got ${liveStepSkipRes.exitCode}`,
      );
    }

    // Verify lexical scoping of testInfoIds: 2nd param 'info' in Test 1 must NOT false-positive on 'const info = { skip: "none" }; info.skip' in Test 2!
    const lexicalScopeDir = path.join(tmpSelfDir, 'lexical-scope-tests');
    for (const t of ['tier1', 'tier2', 'tier3', 'tier4']) {
      fs.mkdirSync(path.join(lexicalScopeDir, t), { recursive: true });
    }
    fs.writeFileSync(
      path.join(lexicalScopeDir, 'tier1', 'lexical-info-scope.spec.ts'),
      `import { test, expect } from '@playwright/test';
test('[T1][F01] test 1 with info param', { tag: ['@tier1', '@F01'] }, async ({ request: _r }, info) => {
  expect(info.title).toContain('test 1');
});
test('[T1][F02] test 2 with local info object', { tag: ['@tier1', '@F02'] }, async () => {
  const info = { skip: 'none' };
  expect(info.skip).toBe('none');
});
`,
      'utf8',
    );
    const lexicalScopeRes = await runNodeSubprocess(
      runnerScript,
      ['--scope', 'lexical-info-scope', '--dry-check'],
      { env: { E2E_TEST_DIR: lexicalScopeDir, E2E_OUTPUT_DIR: outDir }, quiet: true },
    );
    if (lexicalScopeRes.exitCode !== 0) {
      throw new Error(
        `Expected lexical-info-scope --dry-check to exit 0 (no cross-test info false positive), got ${lexicalScopeRes.exitCode}:\n${lexicalScopeRes.stdout}\n${lexicalScopeRes.stderr}`,
      );
    }

    // Verify partial-tier full-suite mode (tier1 has 1 passing test, tier2..4 empty) exits 1!
    const partialSuiteDir = path.join(tmpSelfDir, 'partial-suite-tests');
    for (const t of ['tier1', 'tier2', 'tier3', 'tier4']) {
      fs.mkdirSync(path.join(partialSuiteDir, t), { recursive: true });
    }
    fs.writeFileSync(
      path.join(partialSuiteDir, 'tier1', 'only-t1.spec.ts'),
      `import { test, expect } from '@playwright/test';
test('[T1][F01] isolated tier1 pass', { tag: ['@tier1', '@F01'] }, async () => {
  expect(1).toBe(1);
});
`,
      'utf8',
    );
    const partialFullSuiteRes = await runNodeSubprocess(
      runnerScript,
      [],
      { env: { E2E_TEST_DIR: partialSuiteDir, E2E_OUTPUT_DIR: outDir }, quiet: true },
    );
    if (partialFullSuiteRes.exitCode !== 1) {
      throw new Error(
        `Expected full-suite run with empty tier2..4 to exit 1, got ${partialFullSuiteRes.exitCode}`,
      );
    }

    // 5. Write positive Tier 3 pairwise tag spec + comprehensive Tier 1 harness self-test spec
    fs.writeFileSync(
      path.join(goodTestsDir, 'tier3', 'sample-pairwise.spec.ts'),
      `import { test, expect } from '@playwright/test';
test('[T3][F01][F02] valid pairwise tag contract', { tag: ['@tier3', '@F01', '@F02'] }, async () => {
  expect(2 * 3).toBe(6);
});
`,
      'utf8',
    );

    fs.writeFileSync(
      path.join(goodTestsDir, 'tier1', 'harness-selftest.spec.ts'),
      `import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { test, expect } from '@playwright/test';
import {
  E2E_PATHS,
  E2E_URLS,
  PRIMARY_PROTECTED_DATA_ROOT,
  getProtectedDataRoots,
  assertSafeE2eDataPath,
  isSafeE2eDataPath,
  registerHarnessOwnedVaultRoot,
  isHarnessOwnedVaultRoot,
  buildDefaultBackendEnv,
  assertSafeCleanupRoot,
  ensureStackReady,
  stopManagedStack,
  withIsolatedBackend,
  ApiClient,
  createApiClient,
  unwrapList,
  createPatToken,
  readSseEvents,
  uniqueId,
  CleanupRegistry,
  snapshotSecondBrainFiles,
  cleanupNewSecondBrainFiles,
  McpClient,
  McpHttpError,
  createMcpClient,
  startMockHermesGateway,
  startMockTcpServer,
  startMockHttpServer,
  createYoutubeFixtureEnv,
  waitForAppReady,
  auditZeroBorderRadius,
  auditInteractiveFontFloor,
  auditColorTokens,
  auditPixelatedSprites,
  auditApertureLogo,
  auditOrthogonalBlueprintCorridors,
  FUI_COMPLIANT_SELF_TEST_HTML,
  FUI_VIOLATING_SELF_TEST_HTML,
} from '../../harness';

test('[T1][F01] env.ts: E2E_PATHS, R1-R3 safety guards, ensureStackReady (.wasm + SPA fallback) & withIsolatedBackend', { tag: ['@tier1', '@F01'] }, async () => {
  expect(fs.existsSync(E2E_PATHS.repoRoot)).toBe(true);
  expect(fs.existsSync(E2E_PATHS.e2eRoot)).toBe(true);
  expect(fs.existsSync(E2E_PATHS.systemsReqDir)).toBe(true);
  expect(E2E_URLS.apiBaseUrl).toBe(\`\${E2E_URLS.baseUrl}/api\`);
  expect(E2E_URLS.mcpUrl).toBe(\`\${E2E_URLS.baseUrl}/mcp\`);

  // E2E-S R1 & R2: Temporary stand-in protected data directory checks
  const standInRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-e2e-standin-'));
  const standInData = path.join(standInRoot, 'data');
  fs.mkdirSync(path.join(standInData, 'second-brain'), { recursive: true });
  fs.mkdirSync(path.join(standInData, 'database'), { recursive: true });
  fs.mkdirSync(path.join(standInData, 'knowledge-data', 'lists', 'youtube'), { recursive: true });
  const symlinkToStandIn = path.join(standInRoot, 'sym-to-data');
  fs.symlinkSync(standInData, symlinkToStandIn);

  const savedEnv: Record<string, string | undefined> = {
    E2E_PROTECTED_DATA_ROOTS: process.env.E2E_PROTECTED_DATA_ROOTS,
    E2E_EXTRA_PROTECTED_DATA_ROOTS: process.env.E2E_EXTRA_PROTECTED_DATA_ROOTS,
    SECOND_BRAIN_DIR: process.env.SECOND_BRAIN_DIR,
    YOUTUBE_LISTS_DB: process.env.YOUTUBE_LISTS_DB,
    YOUTUBE_LISTS_NOTES_DIR: process.env.YOUTUBE_LISTS_NOTES_DIR,
    E2E_SECOND_BRAIN_DIR: process.env.E2E_SECOND_BRAIN_DIR,
    E2E_YOUTUBE_LISTS_DB: process.env.E2E_YOUTUBE_LISTS_DB,
    E2E_YOUTUBE_LISTS_NOTES_DIR: process.env.E2E_YOUTUBE_LISTS_NOTES_DIR,
  };
  try {
    process.env.E2E_PROTECTED_DATA_ROOTS = standInData;
    const roots = getProtectedDataRoots();
    expect(roots).toContain(PRIMARY_PROTECTED_DATA_ROOT);
    expect(roots.some((r) => r.endsWith(path.join(path.basename(standInRoot), 'data')))).toBe(true);

    // R1: Plain caller env vars pointing into protected data/ must be ignored in favor of temp fixtures
    delete process.env.E2E_SECOND_BRAIN_DIR;
    delete process.env.E2E_YOUTUBE_LISTS_DB;
    delete process.env.E2E_YOUTUBE_LISTS_NOTES_DIR;
    process.env.SECOND_BRAIN_DIR = path.join(standInData, 'second-brain');
    process.env.YOUTUBE_LISTS_DB = path.join(standInData, 'database', 'youtube-lists.sqlite');
    process.env.YOUTUBE_LISTS_NOTES_DIR = path.join(standInData, 'knowledge-data', 'lists', 'youtube');

    expect(E2E_PATHS.secondBrainDir.startsWith(standInData)).toBe(false);
    expect(E2E_PATHS.youtubeListsDb.startsWith(standInData)).toBe(false);
    expect(E2E_PATHS.youtubeListsNotesDir.startsWith(standInData)).toBe(false);
    expect(isSafeE2eDataPath(E2E_PATHS.secondBrainDir)).toBe(true);
    expect(isSafeE2eDataPath(E2E_PATHS.youtubeListsDb)).toBe(true);
    expect(isSafeE2eDataPath(E2E_PATHS.youtubeListsNotesDir)).toBe(true);

    const builtEnv = buildDefaultBackendEnv('18089');
    expect(builtEnv.SECOND_BRAIN_DIR.startsWith(standInData)).toBe(false);
    expect(builtEnv.YOUTUBE_LISTS_DB.startsWith(standInData)).toBe(false);
    expect(builtEnv.YOUTUBE_LISTS_NOTES_DIR.startsWith(standInData)).toBe(false);

    // R2: Direct, symlinked, missing-leaf symlinked, relative-traversal, empty, and bare tmpdir paths must be rejected
    expect(() => assertSafeE2eDataPath(standInData, 'R2-direct-root')).toThrow(/\\[E2E-SAFETY-GUARD\\]/);
    expect(() => assertSafeE2eDataPath(path.join(standInData, 'second-brain'), 'R2-direct-child')).toThrow(/\\[E2E-SAFETY-GUARD\\]/);
    expect(() => assertSafeE2eDataPath(path.join(symlinkToStandIn, 'second-brain'), 'R2-symlink')).toThrow(/\\[E2E-SAFETY-GUARD\\]/);
    expect(() => assertSafeE2eDataPath(path.join(symlinkToStandIn, 'missing-leaf', 'deep', 'vault'), 'R2-symlink-missing-leaf')).toThrow(/\\[E2E-SAFETY-GUARD\\]/);
    expect(() => assertSafeE2eDataPath(path.join(standInRoot, 'other', '..', 'data', 'second-brain'), 'R2-relative-dots')).toThrow(/\\[E2E-SAFETY-GUARD\\]/);
    expect(() => assertSafeE2eDataPath('', 'R2-empty')).toThrow(/\\[E2E-SAFETY-GUARD\\]/);
    expect(() => assertSafeE2eDataPath(os.tmpdir(), 'R2-bare-tmpdir')).toThrow(/\\[E2E-SAFETY-GUARD\\]/);

    await expect(
      withIsolatedBackend({ SECOND_BRAIN_DIR: path.join(standInData, 'second-brain') }, async () => {}),
    ).rejects.toThrow(/\\[E2E-SAFETY-GUARD\\]/);
    await expect(
      withIsolatedBackend({ YOUTUBE_LISTS_DB: path.join(symlinkToStandIn, 'database', 'youtube-lists.sqlite') }, async () => {}),
    ).rejects.toThrow(/\\[E2E-SAFETY-GUARD\\]/);
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(standInRoot, { recursive: true, force: true });
  }

  // E2E-S R3: Refuse blind reuse of an unverified already-listening server unless E2E_ALLOW_EXTERNAL_SERVER=true
  const rogueServer = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: 'ok',
        db_online: true,
        redis_online: true,
        hermes_gateway: 'offline_mock',
      }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => rogueServer.listen(0, '127.0.0.1', () => r()));
  const roguePort = (rogueServer.address() as net.AddressInfo).port;
  const prevBaseUrl = process.env.E2E_BASE_URL;
  const prevAllowExt = process.env.E2E_ALLOW_EXTERNAL_SERVER;
  try {
    await stopManagedStack();
    process.env.E2E_BASE_URL = \`http://127.0.0.1:\${roguePort}\`;
    delete process.env.E2E_ALLOW_EXTERNAL_SERVER;
    await expect(ensureStackReady({ requireMobile: false })).rejects.toThrow(/\\[E2E-SAFETY-GUARD\\] R3/);

    process.env.E2E_ALLOW_EXTERNAL_SERVER = 'true';
    const extReady = await ensureStackReady({ requireMobile: false });
    expect(extReady.baseUrl).toBe(\`http://127.0.0.1:\${roguePort}\`);
  } finally {
    if (prevBaseUrl === undefined) delete process.env.E2E_BASE_URL;
    else process.env.E2E_BASE_URL = prevBaseUrl;
    if (prevAllowExt === undefined) delete process.env.E2E_ALLOW_EXTERNAL_SERVER;
    else process.env.E2E_ALLOW_EXTERNAL_SERVER = prevAllowExt;
    await new Promise<void>((r) => rogueServer.close(() => r()));
    await stopManagedStack();
  }

  try {
    const ready = await ensureStackReady({ requireMobile: true });
    const healthRes = await fetch(\`\${ready.baseUrl}/api/health\`);
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.status).toBe('ok');

    // Mobile root + SPA deep link fallback + .wasm MIME + 404 on missing asset
    const spaDeepRes = await fetch(\`\${ready.mobileUrl}/companion\`);
    expect(spaDeepRes.status).toBe(200);
    expect(spaDeepRes.headers.get('content-type')).toContain('text/html');
    expect(await spaDeepRes.text()).toContain('HERMES Companion');

    const wasmRes = await fetch(\`\${ready.mobileUrl}/sql-wasm.wasm\`);
    expect(wasmRes.status).toBe(200);
    expect(wasmRes.headers.get('content-type')).toBe('application/wasm');
    const wasmBytes = new Uint8Array(await wasmRes.arrayBuffer());
    expect(Array.from(wasmBytes.slice(0, 4))).toEqual([0x00, 0x61, 0x73, 0x6d]);

    const missingAsset = await fetch(\`\${ready.mobileUrl}/nonexistent-chunk.js\`);
    expect(missingAsset.status).toBe(404);
  } finally {
    await stopManagedStack();
  }

  let capturedIsolatedPortUrl = '';
  await withIsolatedBackend({ TEST_ISOLATED_MARKER: 'isolated-env-verified' }, async (ctx) => {
    capturedIsolatedPortUrl = ctx.baseUrl;
    expect(ctx.apiBaseUrl).toBe(\`\${ctx.baseUrl}/api\`);
    expect(ctx.mcpUrl).toBe(\`\${ctx.baseUrl}/mcp\`);
    const res = await fetch(\`\${ctx.apiBaseUrl}/health\`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isolated_marker).toBe('isolated-env-verified');
    expect(data.second_brain_dir).toContain('hermes-e2e-vault-');
  });

  // Confirm isolated backend process was terminated cleanly
  let postCloseFailed = false;
  try {
    await fetch(\`\${capturedIsolatedPortUrl}/api/health\`, { signal: AbortSignal.timeout(800) });
  } catch {
    postCloseFailed = true;
  }
  expect(postCloseFailed).toBe(true);

  // AST false-positive guard: comments, strings, and domain .skip/.fail/.only fields must be allowed
  // test.skip('commented out skip must not trigger AST error');
  const literalNote = 'Never call test.info().skip() or test.fail() in real specs';
  const paginationDomainObj = { skip: 0, fail: false, only: true };
  expect(literalNote.length).toBeGreaterThan(10);
  expect(paginationDomainObj.skip).toBe(0);

  // Regression Item 5: withIsolatedBackend must NOT leak /tmp/hermes-e2e-vault-* on missing binary or bad shebang!
  const listVaultTmpDirs = () =>
    fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('hermes-e2e-vault-'));
  const prevBackendBin = process.env.E2E_BACKEND_BIN;
  const badShebangPath = path.join(os.tmpdir(), \`hermes-e2e-badshebang-\${process.pid}.sh\`);
  fs.writeFileSync(badShebangPath, '#!/nonexistent/interpreter/for/e2e_m1_selftest\\necho unreachable\\n', {
    encoding: 'utf8',
    mode: 0o755,
  });
  fs.chmodSync(badShebangPath, 0o755);
  try {
    const vaultsBefore = new Set(listVaultTmpDirs());
    process.env.E2E_BACKEND_BIN = path.join(os.tmpdir(), 'nonexistent-hermes-bin-xyz');
    await expect(withIsolatedBackend({}, async () => {})).rejects.toThrow(/not an executable file/);
    const afterMissing = listVaultTmpDirs().filter((d) => !vaultsBefore.has(d));
    expect(afterMissing).toEqual([]);

    process.env.E2E_BACKEND_BIN = badShebangPath;
    await expect(withIsolatedBackend({}, async () => {})).rejects.toThrow(
      /Failed to spawn isolated backend|exited before becoming healthy/,
    );
    const afterBadShebang = listVaultTmpDirs().filter((d) => !vaultsBefore.has(d));
    expect(afterBadShebang).toEqual([]);
  } finally {
    if (prevBackendBin === undefined) {
      delete process.env.E2E_BACKEND_BIN;
    } else {
      process.env.E2E_BACKEND_BIN = prevBackendBin;
    }
    fs.rmSync(badShebangPath, { force: true });
  }
});

test('[T1][F07] api-helpers.ts: ApiClient URL rules, PAT helper, SSE stream reader, CleanupRegistry & Vault cleanup', { tag: ['@tier1', '@F07'] }, async () => {
  const c1 = createApiClient('http://127.0.0.1:8080');
  const c2 = new ApiClient('http://127.0.0.1:8080/api');
  for (const client of [c1, c2]) {
    expect(client.resolveUrl('/goals')).toBe('http://127.0.0.1:8080/api/goals');
    expect(client.resolveUrl('goals')).toBe('http://127.0.0.1:8080/api/goals');
    expect(client.resolveUrl('/api/goals')).toBe('http://127.0.0.1:8080/api/goals');
    expect(client.resolveUrl('/api-tokens')).toBe('http://127.0.0.1:8080/api/api-tokens');
    expect(client.resolveUrl('/mcp')).toBe('http://127.0.0.1:8080/mcp');
    expect(client.resolveUrl('http://127.0.0.1:8080/monitor')).toBe('http://127.0.0.1:8080/monitor');
  }

  // Ephemeral API + SSE server
  const sseSockets = new Set<net.Socket>();
  const apiServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyStr = Buffer.concat(chunks).toString('utf8');
      if (req.url === '/api/auth/login' && req.method === 'POST') {
        res.statusCode = 200;
        res.setHeader('Set-Cookie', 'hermes_session=sess-abc; Path=/; HttpOnly');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ authenticated: true }));
        return;
      }
      if (req.url === '/api/auth/tokens' && req.method === 'POST') {
        if (!req.headers.cookie?.includes('hermes_session=sess-abc')) {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        const parsed = JSON.parse(bodyStr || '{}');
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          id: 'tok-01',
          name: parsed.name,
          token: 'plm_pat_0123456789abcdef0123456789abcdef',
          token_prefix: 'plm_pat_0123',
        }));
        return;
      }
      if (req.url === '/api/tasks') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ tasks: [{ id: 't1', method: req.method, auth: req.headers.authorization || null }] }));
        return;
      }
      if (req.url === '/api/sse-finite') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(': keep-alive comment\\r\\n\\r\\n');
        res.write('event: thinking\\r\\ndata: {"step":1}\\r\\n\\r\\n');
        res.write('event: token\\ndata: line1\\ndata: line2\\n\\n');
        res.write('event: done\\r\\ndata: {"ok":true}\\r\\n\\r\\n');
        res.write('event: ignored_after_stop\\ndata: {"skip":true}\\n\\n');
        res.end();
        return;
      }
      if (req.url === '/api/sse-infinite') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream');
        res.write('event: system_event\\ndata: {"seq":1}\\n\\n');
        // Intentionally keep stream open to verify timeoutMs partial resolution!
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ method: req.method, url: req.url, body: bodyStr ? JSON.parse(bodyStr) : null }));
    });
  });
  apiServer.on('connection', (s) => {
    sseSockets.add(s);
    s.on('error', () => {});
    s.on('close', () => sseSockets.delete(s));
  });

  await new Promise<void>((r) => apiServer.listen(0, '127.0.0.1', () => r()));
  const port = (apiServer.address() as net.AddressInfo).port;
  const origin = \`http://127.0.0.1:\${port}\`;

  try {
    const api = createApiClient(origin);
    const pat = await createPatToken(api, 'SelfTest-Mobile');
    expect(pat.id).toBe('tok-01');
    expect(pat.token).toBe('plm_pat_0123456789abcdef0123456789abcdef');
    expect(pat.tokenPrefix).toBe('plm_pat_0123');

    const authed = api.withToken(pat.token);
    const tasksRes = await authed.get('/tasks');
    expect(tasksRes.ok).toBe(true);
    const list = unwrapList(tasksRes);
    expect(list).toHaveLength(1);
    expect(list[0].auth).toBe(\`Bearer \${pat.token}\`);

    expect(unwrapList([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(unwrapList({ custom_bucket: [{ x: 9 }] })).toEqual([{ x: 9 }]);

    for (const verb of ['post', 'put', 'patch'] as const) {
      const r = await authed[verb]('/echo', { v: verb });
      expect(r.json.method).toBe(verb.toUpperCase());
      expect(r.json.body).toEqual({ v: verb });
    }
    const delRes = await authed.delete('/echo');
    expect(delRes.json.method).toBe('DELETE');

    const finiteEvents = await readSseEvents(\`\${origin}/api/sse-finite\`, { stopOnEvent: 'done' });
    expect(finiteEvents.map((e) => e.event)).toEqual(['thinking', 'token', 'done']);
    expect(finiteEvents[0].parsed).toEqual({ step: 1 });
    expect(finiteEvents[1].data).toBe('line1\\nline2');
    expect(finiteEvents[2].parsed).toEqual({ ok: true });

    const t0 = Date.now();
    const infiniteEvents = await readSseEvents(\`\${origin}/api/sse-infinite\`, { timeoutMs: 180 });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(infiniteEvents).toHaveLength(1);
    expect(infiniteEvents[0].event).toBe('system_event');
    expect(infiniteEvents[0].parsed).toEqual({ seq: 1 });
  } finally {
    for (const s of sseSockets) s.destroy();
    await new Promise<void>((r) => apiServer.close(() => r()));
  }

  // CleanupRegistry LIFO + AggregateError resilience
  expect(uniqueId('task')).not.toBe(uniqueId('task'));
  const order: number[] = [];
  const reg = new CleanupRegistry();
  reg.defer(() => { order.push(1); });
  reg.defer(() => { order.push(2); throw new Error('boom-2'); });
  reg.defer(() => { order.push(3); });
  await expect(reg.runAll()).rejects.toThrow(AggregateError);
  expect(order).toEqual([3, 2, 1]);

  // E2E-S R4: SecondBrain snapshot & cleanup confined to harness-owned temp vault + pre-existing empty dir preservation
  const tempVault = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-e2e-sbtest-'));
  const unownedVault = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-e2e-unowned-'));
  const standInRootR4 = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-e2e-standin-r4-'));
  const standInDataR4 = path.join(standInRootR4, 'data');
  fs.mkdirSync(path.join(standInDataR4, 'second-brain'), { recursive: true });
  const prevProtectedR4 = process.env.E2E_PROTECTED_DATA_ROOTS;
  try {
    process.env.E2E_PROTECTED_DATA_ROOTS = standInDataR4;

    // 1. Refuse stand-in data/ root
    expect(() => snapshotSecondBrainFiles(path.join(standInDataR4, 'second-brain'))).toThrow(/\\[E2E-SAFETY-GUARD\\]/);
    expect(() => cleanupNewSecondBrainFiles(new Set(), path.join(standInDataR4, 'second-brain'))).toThrow(/\\[E2E-SAFETY-GUARD\\]/);

    // 2. Refuse unowned /tmp root (no .hermes-e2e-vault-root marker)
    expect(isHarnessOwnedVaultRoot(unownedVault)).toBe(false);
    expect(() => snapshotSecondBrainFiles(unownedVault)).toThrow(/\\[E2E-SAFETY-GUARD\\] R4/);
    expect(() => cleanupNewSecondBrainFiles(new Set(), unownedVault)).toThrow(/\\[E2E-SAFETY-GUARD\\] R4/);

    // 3. Register tempVault as harness-owned for this run
    registerHarnessOwnedVaultRoot(tempVault);
    expect(isHarnessOwnedVaultRoot(tempVault)).toBe(true);

    // 4. Refuse if .git or .obsidian exists inside the root
    fs.mkdirSync(path.join(tempVault, '.obsidian'), { recursive: true });
    expect(() => snapshotSecondBrainFiles(tempVault)).toThrow(/\\[E2E-SAFETY-GUARD\\] R4/);
    fs.rmSync(path.join(tempVault, '.obsidian'), { recursive: true, force: true });

    fs.mkdirSync(path.join(tempVault, '.git'), { recursive: true });
    expect(() => assertSafeCleanupRoot(tempVault, 'R4-git-check')).toThrow(/\\[E2E-SAFETY-GUARD\\] R4/);
    fs.rmSync(path.join(tempVault, '.git'), { recursive: true, force: true });

    // 5. Verify pre-existing files AND pre-existing empty directories are preserved, while post-snapshot files/dirs are removed
    fs.writeFileSync(path.join(tempVault, '.gitkeep'), '', 'utf8');
    fs.mkdirSync(path.join(tempVault, 'Existing'), { recursive: true });
    fs.writeFileSync(path.join(tempVault, 'Existing', 'keep.md'), '# keep', 'utf8');
    fs.mkdirSync(path.join(tempVault, 'PreExistingEmptyDir', 'NestedEmpty'), { recursive: true });

    const before = snapshotSecondBrainFiles(tempVault);
    expect(before.has('.gitkeep')).toBe(true);
    expect(before.has('Existing/keep.md')).toBe(true);

    fs.mkdirSync(path.join(tempVault, 'Daily'), { recursive: true });
    fs.writeFileSync(path.join(tempVault, 'Daily', '2026-11-14.md'), '# daily', 'utf8');
    fs.mkdirSync(path.join(tempVault, 'Reviews'), { recursive: true });
    fs.writeFileSync(path.join(tempVault, 'Reviews', '2026-W46.md'), '# review', 'utf8');
    fs.writeFileSync(path.join(tempVault, 'Existing', 'transient.md'), '# transient', 'utf8');
    fs.writeFileSync(path.join(tempVault, 'PreExistingEmptyDir', 'transient2.md'), '# transient2', 'utf8');

    cleanupNewSecondBrainFiles(before, tempVault);
    expect(fs.existsSync(path.join(tempVault, '.gitkeep'))).toBe(true);
    expect(fs.existsSync(path.join(tempVault, 'Existing', 'keep.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempVault, 'Existing', 'transient.md'))).toBe(false);
    expect(fs.existsSync(path.join(tempVault, 'PreExistingEmptyDir'))).toBe(true);
    expect(fs.existsSync(path.join(tempVault, 'PreExistingEmptyDir', 'NestedEmpty'))).toBe(true);
    expect(fs.existsSync(path.join(tempVault, 'PreExistingEmptyDir', 'transient2.md'))).toBe(false);
    expect(fs.existsSync(path.join(tempVault, 'Daily'))).toBe(false);
    expect(fs.existsSync(path.join(tempVault, 'Reviews'))).toBe(false);
  } finally {
    if (prevProtectedR4 === undefined) delete process.env.E2E_PROTECTED_DATA_ROOTS;
    else process.env.E2E_PROTECTED_DATA_ROOTS = prevProtectedR4;
    fs.rmSync(tempVault, { recursive: true, force: true });
    fs.rmSync(unownedVault, { recursive: true, force: true });
    fs.rmSync(standInRootR4, { recursive: true, force: true });
  }
});

test('[T1][F10] mcp-helpers.ts & mock-hermes-gateway.ts & mock-probe-target.ts', { tag: ['@tier1', '@F10'] }, async () => {
  // 1. Mock rmcp 3.10.0 Streamable HTTP server
  let initializedNotified = false;
  const mcpSockets = new Set<net.Socket>();
  const rmcpServer = http.createServer((req, res) => {
    if (req.headers.authorization === 'Bearer invalid-pat') {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (req.method === 'DELETE') {
      res.statusCode = 200;
      res.end();
      return;
    }
    const accept = req.headers.accept || '';
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
      res.statusCode = 406;
      res.end('Not Acceptable: Client must accept both application/json and text/event-stream');
      return;
    }
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json')) {
      res.statusCode = 415;
      res.end('Unsupported Media Type');
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (msg.method === 'initialize') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Mcp-Session-Id', 'rmcp-sess-999');
        // Exact rmcp 3.10.0 SEP-1699 priming event + omitted-event JSON-RPC frame
        res.write('id: 0\\nretry: 3000\\ndata: \\n\\n');
        res.write(\`id: 1/0\\ndata: \${JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'hermes-mcp', version: '1.0.0' },
          },
        })}\\n\\n\`);
        res.end();
        return;
      }

      if (req.headers['mcp-session-id'] !== 'rmcp-sess-999') {
        res.statusCode = 400;
        res.end('Bad Request: Session ID is required');
        return;
      }

      if (msg.method === 'notifications/initialized') {
        initializedNotified = true;
        res.statusCode = 202;
        res.end();
        return;
      }

      if (!initializedNotified) {
        res.statusCode = 400;
        res.end('Session not yet initialized');
        return;
      }

      if (msg.method === 'tools/list') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream');
        res.write('id: 0\\nretry: 3000\\ndata: \\n\\n');
        res.write(\`id: 2/0\\ndata: \${JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [
              { name: 'todos_create_task', description: 'Create task', inputSchema: { type: 'object' } },
              { name: 'finance_upsert_asset', description: 'Upsert asset', inputSchema: { type: 'object' } },
            ],
          },
        })}\\n\\n\`);
        res.end();
        return;
      }

      if (msg.method === 'tools/call') {
        const isFinance = msg.params?.name === 'finance_upsert_asset';
        const payload = isFinance
          ? { status: 'pending_approval', approval_id: 'appr-777' }
          : { status: 'executed', undo_id: 'undo-555', title: msg.params?.arguments?.title };
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(payload) }],
            isError: false,
          },
        }));
        return;
      }

      res.statusCode = 404;
      res.end();
    });
  });
  rmcpServer.on('connection', (s) => {
    mcpSockets.add(s);
    s.on('error', () => {});
    s.on('close', () => mcpSockets.delete(s));
  });
  await new Promise<void>((r) => rmcpServer.listen(0, '127.0.0.1', () => r()));
  const mcpPort = (rmcpServer.address() as net.AddressInfo).port;
  const mcpUrl = \`http://127.0.0.1:\${mcpPort}/mcp\`;

  try {
    // Verify 401 handling
    const badMcp = createMcpClient(mcpUrl, 'invalid-pat');
    await expect(badMcp.initialize()).rejects.toBeInstanceOf(McpHttpError);
    await expect(badMcp.initialize()).rejects.toMatchObject({ status: 401 });

    // Verify full rmcp handshake, hybrid listTools, undoId & approvalId extraction
    const mcp = new McpClient(mcpUrl, 'plm_pat_valid');
    const tools = await mcp.listTools();
    expect(mcp.sessionId).toBe('rmcp-sess-999');
    expect(tools.map((t) => t.name)).toEqual(['todos_create_task', 'finance_upsert_asset']);
    expect(tools.tools).toHaveLength(2);

    const undoCall = await mcp.callTool('todos_create_task', { title: 'Write E2E suite' });
    expect(undoCall.ok).toBe(true);
    expect(undoCall.undoId).toBe('undo-555');

    const apprCall = await mcp.callTool('finance_upsert_asset', { ticker: 'WEGE3' });
    expect(apprCall.ok).toBe(true);
    expect(apprCall.approvalId).toBe('appr-777');
    expect(await mcp.closeSession()).toBe(200);

    // 2. Mock Hermes Gateway (models, streaming <thinking>, triggerMcpCall, /v1/runs, failStatus, hangMs fast close)
    const gw = await startMockHermesGateway({
      triggerMcpCall: {
        mcpUrl,
        toolName: 'todos_create_task',
        args: { title: 'Gateway-triggered task' },
      },
    });
    try {
      const modelsRes = await fetch(\`\${gw.baseV1Url}/models\`);
      expect(modelsRes.status).toBe(200);

      const streamEvents = await readSseEvents(\`\${gw.baseV1Url}/chat/completions\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Key': 'sess-shared-01',
          Authorization: 'Bearer test-gw-key',
        },
        body: JSON.stringify({
          stream: true,
          messages: [{ role: 'user', content: '[🧠 HIGH_LEVEL_PLAN] Plan Q1 goals' }],
        }),
      });
      const combinedContent = streamEvents
        .map((e) => e.parsed?.choices?.[0]?.delta?.content || '')
        .join('');
      expect(combinedContent).toContain('<thinking>');
      expect(combinedContent).toContain('</thinking>');
      expect(combinedContent).toContain('undo=undo-555');
      expect(gw.requests.some((r) => r.sessionKey === 'sess-shared-01')).toBe(true);

      // Regression Item 10: high_level_mode: false & highLevelMode: false must NOT emit <thinking>
      const nonThinkingRes = await fetch(\`\${gw.baseV1Url}/chat/completions\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream: false,
          high_level_mode: false,
          messages: [{ role: 'user', content: 'Quick hello without thinking' }],
        }),
      });
      expect(nonThinkingRes.status).toBe(200);
      const nonThinkingJson = await nonThinkingRes.json();
      expect(nonThinkingJson.choices[0].message.content).not.toContain('<thinking>');

      const explicitFalseOverrideRes = await fetch(\`\${gw.baseV1Url}/chat/completions\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream: false,
          highLevelMode: false,
          messages: [{ role: 'user', content: '[🧠 HIGH_LEVEL_PLAN] explicitly disabled' }],
        }),
      });
      const explicitFalseJson = await explicitFalseOverrideRes.json();
      expect(explicitFalseJson.choices[0].message.content).not.toContain('<thinking>');

      const runRes = await fetch(\`\${gw.baseV1Url}/runs\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hermes-Session-Key': 'knight-01' },
        body: JSON.stringify({ prompt: 'Audit portfolio' }),
      });
      expect(runRes.status).toBe(200);
      const runJson = await runRes.json();
      expect(runJson.run_id).toBeTruthy();

      const getRunRes = await fetch(\`\${gw.baseV1Url}/runs/\${runJson.run_id}\`);
      expect(getRunRes.status).toBe(200);

      gw.setOptions({ failStatus: 503 });
      const failRes = await fetch(\`\${gw.baseV1Url}/models\`);
      expect(failRes.status).toBe(503);

      gw.setOptions({ failStatus: undefined, hangMs: 10_000 });
      const inflight = fetch(\`\${gw.baseV1Url}/models\`).catch(() => null);
      await new Promise((r) => setTimeout(r, 40));
      const closeT0 = Date.now();
      await gw.close();
      expect(Date.now() - closeT0).toBeLessThan(500);
      await inflight;
    } finally {
      await gw.close();
    }
  } finally {
    for (const s of mcpSockets) s.destroy();
    await new Promise<void>((r) => rmcpServer.close(() => r()));
  }

  // 3. Mock TCP & HTTP probe targets
  const tcpTarget = await startMockTcpServer();
  const idleClient = net.connect(tcpTarget.port, tcpTarget.host);
  await new Promise<void>((resolve, reject) => {
    idleClient.once('connect', () => resolve());
    idleClient.once('error', reject);
  });
  const tcpCloseT0 = Date.now();
  await tcpTarget.close();
  expect(Date.now() - tcpCloseT0).toBeLessThan(500);
  expect(tcpTarget.connections).toBeGreaterThanOrEqual(1);

  const httpTarget = await startMockHttpServer(200, '{"status":"online"}');
  const r200 = await fetch(httpTarget.url);
  expect(r200.status).toBe(200);
  httpTarget.setResponse(503, '{"status":"degraded"}');
  const r503 = await fetch(httpTarget.url);
  expect(r503.status).toBe(503);
  await httpTarget.close();

  // Regression Item 9: McpClient fails closed on truncated priming-only SSE stream & SSE timeout
  let faultMode: 'truncate' | 'hang' = 'truncate';
  const faultSockets = new Set<net.Socket>();
  const faultMcpServer = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Mcp-Session-Id', 'fault-sess');
    res.write('id: 0\\nretry: 3000\\ndata: \\n\\n');
    if (faultMode === 'truncate') {
      res.end();
    }
  });
  faultMcpServer.on('connection', (s) => {
    faultSockets.add(s);
    s.on('error', () => {});
    s.on('close', () => faultSockets.delete(s));
  });
  await new Promise<void>((r) => faultMcpServer.listen(0, '127.0.0.1', () => r()));
  const faultPort = (faultMcpServer.address() as net.AddressInfo).port;
  const faultMcpUrl = \`http://127.0.0.1:\${faultPort}/mcp\`;
  try {
    const truncClient = createMcpClient(faultMcpUrl);
    await expect(truncClient.initialize()).rejects.toBeInstanceOf(McpHttpError);
    await expect(truncClient.initialize()).rejects.toThrow(
      'MCP response missing JSON-RPC result/error envelope',
    );
    truncClient.initialized = true;
    await expect(truncClient.listTools()).rejects.toBeInstanceOf(McpHttpError);
    await expect(truncClient.listTools()).rejects.toThrow(
      'MCP response missing JSON-RPC result/error envelope',
    );
    await expect(truncClient.callTool('todos_list_tasks', {})).rejects.toBeInstanceOf(McpHttpError);
    await expect(truncClient.callTool('todos_list_tasks', {})).rejects.toThrow(
      'MCP response missing JSON-RPC result/error envelope',
    );

    faultMode = 'hang';
    const hangClient = createMcpClient(faultMcpUrl);
    await expect(
      hangClient.sendRawRpc({ jsonrpc: '2.0', id: 77, method: 'tools/list' }, undefined, {
        timeoutMs: 120,
      }),
    ).rejects.toBeInstanceOf(McpHttpError);
    await expect(
      hangClient.sendRawRpc({ jsonrpc: '2.0', id: 78, method: 'tools/list' }, undefined, {
        timeoutMs: 120,
      }),
    ).rejects.toThrow(/timed out/i);
  } finally {
    for (const s of faultSockets) s.destroy();
    await new Promise<void>((r) => faultMcpServer.close(() => r()));
  }
});

test('[T1][F16] youtube-fixtures.ts: exact youtube-lists & youtube-ai migrations in ?mode=ro', { tag: ['@tier1', '@F16'] }, async () => {
  const fullEnv = await createYoutubeFixtureEnv({
    includeAiTable: true,
    includeSharedRefNote: true,
    includeUnavailableVideos: true,
  });
  try {
    expect(fullEnv.playlistId).toBe('PL_DIST_SYS_01');
    expect(fullEnv.secondPlaylistId).toBe('PL_RUST_ASYNC_02');
    expect(fullEnv.videoIds).toEqual(['vDistSys001', 'vDistSys002', 'vDistSys003']);

    // Verify read-only SQLite compatibility + zero pending crawler migrations
    const roCheckJson = execFileSync(
      '/usr/bin/python3',
      [
        '-B',
        '-c',
        \`
import importlib.util, json, os, sqlite3, sys
repo_root, db_path = sys.argv[1], sys.argv[2]
def load(name, p):
    s = importlib.util.spec_from_file_location(name, p)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m
lr = load("lr", os.path.join(repo_root, "crawlers/youtube-lists/migrations/runner.py"))
ar = load("ar", os.path.join(repo_root, "crawlers/youtube-ai/migrations/runner.py"))
conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
jm = conn.execute("PRAGMA journal_mode").fetchone()[0]
fk = conn.execute("PRAGMA foreign_key_check").fetchall()
active_pl = [r[0] for r in conn.execute("SELECT id FROM playlist WHERE removed_at IS NULL ORDER BY id").fetchall()]
print(json.dumps({
    "lists_pending": lr.pending(conn),
    "ai_pending": ar.pending(conn),
    "journal_mode": jm,
    "fk_errors": fk,
    "active_playlists": active_pl,
}))
conn.close()
\`,
        E2E_PATHS.repoRoot,
        fullEnv.dbPath,
      ],
      { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
    );
    const parsedCheck = JSON.parse(roCheckJson.trim());
    expect(parsedCheck.lists_pending).toEqual([]);
    expect(parsedCheck.ai_pending).toEqual([]);
    expect(parsedCheck.journal_mode.toLowerCase()).toBe('delete');
    expect(parsedCheck.fk_errors).toEqual([]);
    expect(parsedCheck.active_playlists).toEqual(['PL_DIST_SYS_01', 'PL_RUST_ASYNC_02']);

    // Verify Markdown files on disk (-ai-knowledge.md redaction matching crawlers/youtube-ai/utils/secrets.py, -ref.md, hidden .private-video)
    const aiKnowPath = path.join(
      fullEnv.notesDir,
      'distributed-systems/videos/raft-consensus-log-replication/raft-consensus-log-replication-ai-knowledge.md',
    );
    const aiKnowDiskText = fs.readFileSync(aiKnowPath, 'utf8');
    expect(aiKnowDiskText).toContain('[redacted API key]');
    expect(aiKnowDiskText).not.toContain('sk-proj-');
    expect(
      fs.existsSync(
        path.join(
          fullEnv.notesDir,
          'distributed-systems/videos/tokio-work-stealing-scheduler/tokio-work-stealing-scheduler-ref.md',
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(fullEnv.notesDir, 'distributed-systems/videos/.private-video/private-video.md'),
      ),
    ).toBe(true);
  } finally {
    const dirCopy = fullEnv.dir;
    await fullEnv.cleanup();
    expect(fs.existsSync(dirCopy)).toBe(false);
  }

  // Also verify includeAiTable: false
  const noAiEnv = await createYoutubeFixtureEnv({ includeAiTable: false });
  try {
    const tablesJson = execFileSync(
      '/usr/bin/python3',
      [
        '-B',
        '-c',
        'import json, sqlite3, sys; c=sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True); print(json.dumps([r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type=\\'table\\'").fetchall()]))',
        noAiEnv.dbPath,
      ],
      { encoding: 'utf8' },
    );
    const tables = JSON.parse(tablesJson.trim()) as string[];
    expect(tables).toContain('playlist');
    expect(tables).not.toContain('ai_note');
  } finally {
    const dirCopy = noAiEnv.dir;
    await noAiEnv.cleanup();
    expect(fs.existsSync(dirCopy)).toBe(false);
  }
});

test('[T1][F18] fui-rubric.ts: all 7 DOM/style inspectors on compliant & violating fixtures in Chrome', { tag: ['@tier1', '@F18'] }, async ({ page }) => {
  const compliantUrl = \`data:text/html;charset=utf-8,\${encodeURIComponent(FUI_COMPLIANT_SELF_TEST_HTML)}\`;
  await waitForAppReady(page, compliantUrl);
  expect(await page.locator('#boot-gate').count()).toBe(0);

  const cRadius = await auditZeroBorderRadius(page);
  expect(cRadius.checkedCount).toBeGreaterThan(0);
  expect(cRadius.violations).toEqual([]);

  const cFont = await auditInteractiveFontFloor(page);
  expect(cFont.checkedCount).toBeGreaterThanOrEqual(4);
  expect(cFont.violations).toEqual([]);

  const cColors = await auditColorTokens(page);
  expect(cColors.bgRgb).toBe('rgb(8, 8, 11)');
  expect(cColors.hasCarbonBg).toBe(true);
  expect(cColors.hasBlazeOrangeAccent).toBe(true);
  expect(cColors.hasStarkWhiteInk).toBe(true);
  expect(cColors.customProps['--fui-bg-carbon']).toBe('#08080B');

  const cSprites = await auditPixelatedSprites(page);
  expect(cSprites.spriteCount).toBe(1);
  expect(cSprites.violations).toEqual([]);

  const cLogo = await auditApertureLogo(page);
  expect(cLogo).toEqual({
    found: true,
    svgLayerCount: 5,
    hasOrangeGear: true,
    hasShutterBlades: true,
    hasStatusIris: true,
  });

  const cBlueprint = await auditOrthogonalBlueprintCorridors(page);
  expect(cBlueprint.segmentCount).toBe(7);
  expect(cBlueprint.diagonalOrCurvedViolations).toEqual([]);

  // Violating HTML fixture — every auditor must catch its injected defect
  const violatingUrl = \`data:text/html;charset=utf-8,\${encodeURIComponent(FUI_VIOLATING_SELF_TEST_HTML)}\`;
  await waitForAppReady(page, violatingUrl);

  const vRadius = await auditZeroBorderRadius(page);
  expect(vRadius.violations.some((v) => v.tag === 'button' && v.borderRadius.includes('8px'))).toBe(true);
  expect(vRadius.violations.some((v) => v.tag === 'div' && v.borderRadius.includes('12px'))).toBe(true);

  const vFont = await auditInteractiveFontFloor(page);
  expect(vFont.violations.some((v) => v.tag === 'button' && v.fontSize === '10px')).toBe(true);

  const vColors = await auditColorTokens(page);
  expect(vColors.hasCarbonBg).toBe(false);
  expect(vColors.hasBlazeOrangeAccent).toBe(false);
  expect(vColors.hasStarkWhiteInk).toBe(false);

  const vSprites = await auditPixelatedSprites(page);
  expect(vSprites.spriteCount).toBe(1);
  expect(vSprites.violations.some((v) => v.tag === 'canvas' && v.imageRendering === 'auto')).toBe(true);

  const vLogo = await auditApertureLogo(page);
  expect(vLogo.found).toBe(true);
  expect(vLogo.svgLayerCount).toBeLessThan(5);
  expect(vLogo.hasOrangeGear).toBe(false);
  expect(vLogo.hasShutterBlades).toBe(false);
  expect(vLogo.hasStatusIris).toBe(false);

  const vBlueprint = await auditOrthogonalBlueprintCorridors(page);
  expect(vBlueprint.diagonalOrCurvedViolations).toHaveLength(2);

  // Regression Items 6, 7 & 8: Blueprint child icon <svg>s, PascalCase/underscore/plural hints, multi-level HUD rings & bare/img/asymmetric sprite zoom
  const makeSolidPngDataUri = (w: number, h: number): string => {
    const pngChunk = (type: string, data: Buffer): Buffer => {
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(data.length, 0);
      const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
      const crcBuf = Buffer.alloc(4);
      crcBuf.writeUInt32BE(zlib.crc32(typeAndData) >>> 0, 0);
      return Buffer.concat([lenBuf, typeAndData, crcBuf]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const rawRows = Buffer.alloc(h * (1 + w * 4), 0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const off = y * (1 + w * 4) + 1 + x * 4;
        rawRows[off] = 248;
        rawRows[off + 1] = 124;
        rawRows[off + 2] = 24;
        rawRows[off + 3] = 255;
      }
    }
    const idat = zlib.deflateSync(rawRows);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', idat),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
    return \`data:image/png;base64,\${png.toString('base64')}\`;
  };
  const png32Uri = makeSolidPngDataUri(32, 32);

  const edgeCompliantHtml = \`<!doctype html><html><body style="margin:0;background:#08080B;color:#F6F6F4;">
    <main>
      <div class="GeodesicThinkingOrb" style="position:relative;width:120px;height:120px;">
        <div class="orbit_shell"><div class="inner_layer">
          <div style="width:48px;height:48px;border-radius:50%;border:1px solid #2CE5F2;"></div>
        </div></div>
      </div>
      <div class="CompanionStage">
        <img src="\${png32Uri}" alt="frieren_idle" style="width:64px;height:64px;image-rendering:pixelated;" />
      </div>
      <canvas width="32" height="32" style="width:96px;height:96px;image-rendering:pixelated;"></canvas>
      <canvas class="WaveformSparkline" width="180" height="40" style="image-rendering:auto;"></canvas>
      <canvas class="FocusBarcode24h" width="180" height="24" style="image-rendering:auto;"></canvas>
      <div class="blueprint-container" style="position:relative;">
        <svg width="600" height="400" viewBox="0 0 600 400">
          <path d="M 80 60 H 220 V 180 H 360" fill="none" stroke="#DCE8EE" stroke-width="2" />
          <g class="status-icon"><polyline points="2 6 6 10 14 2" fill="none" stroke="#A8F040" /></g>
          <foreignObject x="20" y="20" width="80" height="40">
            <div xmlns="http://www.w3.org/1999/xhtml">
              <svg width="16" height="16" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" fill="none" stroke="#A8F040" /></svg>
            </div>
          </foreignObject>
        </svg>
        <div class="goal-room-card">
          <svg width="16" height="16" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" fill="none" stroke="#A8F040" stroke-width="2" /></svg>
        </div>
        <div style="display:none;">
          <svg width="400" height="300"><line x1="0" y1="0" x2="100" y2="100" stroke="#F87C18" /></svg>
        </div>
      </div>
    </main>
  </body></html>\`;

  await page.setContent(edgeCompliantHtml, { waitUntil: 'load' });
  const edgeRadius = await auditZeroBorderRadius(page);
  expect(edgeRadius.violations).toEqual([]);
  const edgeSprites = await auditPixelatedSprites(page);
  expect(edgeSprites.spriteCount).toBe(2);
  expect(edgeSprites.violations).toEqual([]);
  const edgeBlueprint = await auditOrthogonalBlueprintCorridors(page);
  expect(edgeBlueprint.segmentCount).toBe(3);
  expect(edgeBlueprint.diagonalOrCurvedViolations).toEqual([]);

  const edgeViolatingHtml = \`<!doctype html><html><body style="margin:0;background:#08080B;">
    <main>
      <button type="button" class="GeodesicThinkingOrb" style="width:36px;height:36px;border-radius:50%;">X</button>
      <canvas width="32" height="32" style="width:48px;height:48px;image-rendering:pixelated;"></canvas>
      <canvas data-sprite="frieren" width="32" height="32" style="width:64px;height:48px;image-rendering:pixelated;"></canvas>
      <img src="\${png32Uri}" style="width:48px;height:48px;image-rendering:pixelated;" />
    </main>
  </body></html>\`;

  await page.setContent(edgeViolatingHtml, { waitUntil: 'load' });
  const badEdgeRadius = await auditZeroBorderRadius(page);
  expect(badEdgeRadius.violations.some((v) => v.tag === 'button')).toBe(true);
  const badEdgeSprites = await auditPixelatedSprites(page);
  expect(badEdgeSprites.spriteCount).toBe(3);
  expect(badEdgeSprites.violations).toHaveLength(3);
  expect(badEdgeSprites.violations.some((v) => v.imageRendering.includes('zoom=1.50x'))).toBe(true);
  expect(badEdgeSprites.violations.some((v) => v.imageRendering.includes('zoom=2.00x/1.50x'))).toBe(true);

  // Regression Item (ix) — Challenger 4 Challenge 1 & Challenge 2 DOM fixtures
  const challenger4Html = \`<!doctype html><html><body style="margin:0;background:#08080B;color:#F6F6F4;">
    <main>
      <section class="isometric-knight-arena">
        <canvas class="arena-grid" width="800" height="400" style="width:740px;height:370px;image-rendering:auto"></canvas>
        <canvas data-sprite="knight" width="32" height="32" style="width:64px;height:64px;image-rendering:pixelated"></canvas>
      </section>
      <aside class="frieren-popover">
        <img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'></svg>" width="16" height="16" style="image-rendering:auto" />
      </aside>
      <canvas class="PairedHatchBarChart" width="300" height="150" style="width:340px;height:150px;image-rendering:pixelated"></canvas>
      <canvas class="habit-heatmap-365d" width="200" height="50" style="width:284px;height:50px;image-rendering:crisp-edges"></canvas>
      <div class="pairing-qr-modal">
        <img class="qr-code" src="\${png32Uri}" style="width:140px;height:140px;image-rendering:pixelated" />
      </div>
      <svg data-testid="goal-blueprint" width="600" height="400" viewBox="0 0 600 400">
        <path d="M 80 60 H 220 V 180 H 360" stroke="#DCE8EE" fill="none" />
        <polyline points="354,176 360,180 354,184" stroke="#DCE8EE" fill="none" />
        <g class="goal-node">
          <polyline points="8,22 12,26 20,18" stroke="#A8F040" fill="none" />
        </g>
      </svg>
    </main>
  </body></html>\`;

  await page.setContent(challenger4Html, { waitUntil: 'load' });
  const c4Sprites = await auditPixelatedSprites(page);
  expect(c4Sprites.spriteCount).toBe(1);
  expect(c4Sprites.violations).toEqual([]);

  const c4Blueprint = await auditOrthogonalBlueprintCorridors(page);
  expect(c4Blueprint.segmentCount).toBe(3);
  expect(c4Blueprint.diagonalOrCurvedViolations).toEqual([]);
});
`,
      'utf8',
    );

    // 6. Stage C: Positive --scope ... --dry-check (relative & absolute) + unscoped E2E_TEST_DIR matrix checks
    console.log(`[self-test] Stage C: Verifying positive --scope (incl. absolute path) & unscoped E2E_TEST_DIR --dry-check...`);
    for (const goodScope of [
      'harness-selftest',
      'sample-pairwise',
      path.join(goodTestsDir, 'tier1', 'harness-selftest.spec.ts'),
    ]) {
      const posRes = await runNodeSubprocess(
        runnerScript,
        ['--scope', goodScope, '--dry-check'],
        { env: { E2E_TEST_DIR: goodTestsDir }, quiet: true },
      );
      if (posRes.exitCode !== 0) {
        throw new Error(
          `Expected positive --scope ${goodScope} --dry-check to exit 0, got ${posRes.exitCode}:\n${posRes.stdout}\n${posRes.stderr}`,
        );
      }
    }

    // Build 414-test synthetic matrix in matrixDir to verify unscoped --dry-check E2E_TEST_DIR TS check & orphan spec detection
    const matrixDir = path.join(tmpSelfDir, 'matrix-tests');
    for (const t of ['tier1', 'tier2', 'tier3', 'tier4']) {
      fs.mkdirSync(path.join(matrixDir, t), { recursive: true });
    }
    const buildMatrixTier = (tierNum, lines) =>
      `import { test, expect } from '@playwright/test';\n${lines.join('\n')}\n`;
    const t1Lines = [];
    const t2Lines = [];
    const t3Lines = [];
    const t4Lines = [];
    for (let i = 0; i < ALL_FEATURES.length; i += 1) {
      const f = ALL_FEATURES[i];
      const nextF = ALL_FEATURES[(i + 1) % ALL_FEATURES.length];
      for (let k = 1; k <= 5; k += 1) {
        t1Lines.push(`test('[T1][${f}] c${k}', { tag: ['@tier1', '@${f}'] }, async () => { expect(${k}).toBe(${k}); });`);
        t2Lines.push(`test('[T2][${f}] c${k}', { tag: ['@tier2', '@${f}'] }, async () => { expect(${k}).toBe(${k}); });`);
      }
      t3Lines.push(`test('[T3][${f}][${nextF}] pair', { tag: ['@tier3', '@${f}', '@${nextF}'] }, async () => { expect(1).toBe(1); });`);
    }
    for (let s = 1; s <= 18; s += 1) {
      t4Lines.push(`test('[T4][F01] scenario ${s}', { tag: ['@tier4', '@F01', '@F02'] }, async () => { expect(${s}).toBe(${s}); });`);
    }
    fs.writeFileSync(path.join(matrixDir, 'tier1', 'matrix-t1.spec.ts'), buildMatrixTier(1, t1Lines), 'utf8');
    fs.writeFileSync(path.join(matrixDir, 'tier2', 'matrix-t2.spec.ts'), buildMatrixTier(2, t2Lines), 'utf8');
    fs.writeFileSync(path.join(matrixDir, 'tier3', 'matrix-t3.spec.ts'), buildMatrixTier(3, t3Lines), 'utf8');
    fs.writeFileSync(path.join(matrixDir, 'tier4', 'matrix-t4.spec.ts'), buildMatrixTier(4, t4Lines), 'utf8');

    const matrixOkRes = await runNodeSubprocess(
      runnerScript,
      ['--dry-check'],
      { env: { E2E_TEST_DIR: matrixDir }, quiet: true },
    );
    if (matrixOkRes.exitCode !== 0) {
      throw new Error(
        `Expected unscoped --dry-check on valid 414-test matrixDir to exit 0, got ${matrixOkRes.exitCode}:\n${matrixOkRes.stdout}\n${matrixOkRes.stderr}`,
      );
    }

    // Orphan spec outside tier1..4 must fail unscoped --dry-check
    const orphanSpecPath = path.join(matrixDir, 'orphan-root.spec.ts');
    fs.writeFileSync(
      orphanSpecPath,
      `import { test, expect } from '@playwright/test';\ntest('orphan', async () => { expect(1).toBe(1); });\n`,
      'utf8',
    );
    const orphanRes = await runNodeSubprocess(
      runnerScript,
      ['--dry-check'],
      { env: { E2E_TEST_DIR: matrixDir }, quiet: true },
    );
    fs.rmSync(orphanSpecPath, { force: true });
    if (orphanRes.exitCode !== 1) {
      throw new Error(`Expected unscoped --dry-check with orphan root spec to exit 1, got ${orphanRes.exitCode}`);
    }

    // TypeScript error inside E2E_TEST_DIR must fail unscoped --dry-check
    const tsBrokenSpecPath = path.join(matrixDir, 'tier1', 'ts-broken.spec.ts');
    fs.writeFileSync(
      tsBrokenSpecPath,
      `import { test, expect } from '@playwright/test';\nconst badNum: number = 'NOT_A_NUMBER';\ntest('[T1][F01] broken ts', { tag: ['@tier1', '@F01'] }, async () => { expect(badNum).toBe(1); });\n`,
      'utf8',
    );
    const tsBrokenRes = await runNodeSubprocess(
      runnerScript,
      ['--dry-check'],
      { env: { E2E_TEST_DIR: matrixDir }, quiet: true },
    );
    fs.rmSync(tsBrokenSpecPath, { force: true });
    if (tsBrokenRes.exitCode !== 1) {
      throw new Error(`Expected unscoped --dry-check with TS error in E2E_TEST_DIR to exit 1, got ${tsBrokenRes.exitCode}`);
    }

    // Runtime test.info().skip() inside E2E_TEST_DIR must fail unscoped --dry-check
    const astSkipSpecPath = path.join(matrixDir, 'tier4', 'ast-skip.spec.ts');
    fs.writeFileSync(
      astSkipSpecPath,
      `import { test, expect } from '@playwright/test';\ntest('[T4][F01] runtime skip', { tag: ['@tier4', '@F01', '@F02'] }, async () => { test.info().skip(); expect(1).toBe(1); });\n`,
      'utf8',
    );
    const astSkipRes = await runNodeSubprocess(
      runnerScript,
      ['--dry-check'],
      { env: { E2E_TEST_DIR: matrixDir }, quiet: true },
    );
    fs.rmSync(astSkipSpecPath, { force: true });
    if (astSkipRes.exitCode !== 1) {
      throw new Error(`Expected unscoped --dry-check with runtime test.info().skip() to exit 1, got ${astSkipRes.exitCode}`);
    }

    // Also verify --list WITHOUT --allow-empty exits 0 when tests ARE present
    const nonEmptyListRes = await runNodeSubprocess(
      runnerScript,
      ['--list'],
      { env: { E2E_TEST_DIR: goodTestsDir, E2E_OUTPUT_DIR: outDir }, quiet: true },
    );
    if (nonEmptyListRes.exitCode !== 0) {
      throw new Error(
        `Expected --list on non-empty dir to exit 0, got ${nonEmptyListRes.exitCode}`,
      );
    }

    // 6b. Stage C-Safety (R1, R2, R5 CLI-level self-tests)
    console.log(`[self-test] Stage C-Safety: Verifying CLI R1 default temp fixtures, R2 protected data/ guards, and R5 scoped/filtered runs...`);
    const cliStandInRoot = path.join(tmpSelfDir, 'cli-standin');
    const cliStandInData = path.join(cliStandInRoot, 'data');
    fs.mkdirSync(path.join(cliStandInData, 'second-brain'), { recursive: true });
    fs.mkdirSync(path.join(cliStandInData, 'database'), { recursive: true });
    fs.mkdirSync(path.join(cliStandInData, 'knowledge-data', 'lists', 'youtube'), { recursive: true });
    const cliStandInSym = path.join(cliStandInRoot, 'sym-data');
    fs.symlinkSync(cliStandInData, cliStandInSym);

    // R1 CLI: Plain caller env vars pointing into stand-in data/ are ignored in favor of temp fixtures
    const r1PrintEnvRes = await runNodeSubprocess(
      runnerScript,
      ['--print-env'],
      {
        env: {
          E2E_TEST_DIR: goodTestsDir,
          E2E_OUTPUT_DIR: outDir,
          E2E_PROTECTED_DATA_ROOTS: cliStandInData,
          E2E_RUN_FIXTURE_ROOT: undefined,
          E2E_SECOND_BRAIN_DIR: undefined,
          E2E_YOUTUBE_LISTS_DB: undefined,
          E2E_YOUTUBE_LISTS_NOTES_DIR: undefined,
          SECOND_BRAIN_DIR: path.join(cliStandInData, 'second-brain'),
          YOUTUBE_LISTS_DB: path.join(cliStandInData, 'database', 'youtube-lists.sqlite'),
          YOUTUBE_LISTS_NOTES_DIR: path.join(cliStandInData, 'knowledge-data', 'lists', 'youtube'),
        },
        quiet: true,
      },
    );
    if (r1PrintEnvRes.exitCode !== 0) {
      throw new Error(`Expected --print-env with plain caller data/ env vars to exit 0 (R1), got ${r1PrintEnvRes.exitCode}:\n${r1PrintEnvRes.stderr}`);
    }
    if (r1PrintEnvRes.stdout.includes(cliStandInData)) {
      throw new Error(`R1 violation: --print-env resolved into protected stand-in data/ dir:\n${r1PrintEnvRes.stdout}`);
    }

    // R2 CLI: Explicit E2E_* overrides pointing into stand-in data/ (direct, symlink, missing leaf, relative '..', empty string) must fail fast with [E2E-SAFETY-GUARD]
    for (const [caseLabel, badEnvOverride] of [
      ['direct-vault', { E2E_SECOND_BRAIN_DIR: path.join(cliStandInData, 'second-brain') }],
      ['symlink-vault', { E2E_SECOND_BRAIN_DIR: path.join(cliStandInSym, 'second-brain') }],
      ['symlink-missing-leaf-db', { E2E_YOUTUBE_LISTS_DB: path.join(cliStandInSym, 'missing-dir', 'youtube-lists.sqlite') }],
      ['relative-dots-notes', { E2E_YOUTUBE_LISTS_NOTES_DIR: path.join(cliStandInRoot, 'sub', '..', 'data', 'knowledge-data') }],
      ['empty-string-vault', { E2E_SECOND_BRAIN_DIR: '' }],
    ]) {
      const r2CliRes = await runNodeSubprocess(
        runnerScript,
        ['--print-env'],
        {
          env: {
            E2E_TEST_DIR: goodTestsDir,
            E2E_OUTPUT_DIR: outDir,
            E2E_PROTECTED_DATA_ROOTS: cliStandInData,
            E2E_RUN_FIXTURE_ROOT: undefined,
            E2E_SECOND_BRAIN_DIR: undefined,
            E2E_YOUTUBE_LISTS_DB: undefined,
            E2E_YOUTUBE_LISTS_NOTES_DIR: undefined,
            ...badEnvOverride,
          },
          quiet: true,
        },
      );
      if (r2CliRes.exitCode === 0 || !r2CliRes.stderr.includes('[E2E-SAFETY-GUARD]')) {
        throw new Error(
          `Expected R2 CLI guard (${caseLabel}) to exit non-zero with [E2E-SAFETY-GUARD], got code=${r2CliRes.exitCode}, stderr=${r2CliRes.stderr}`,
        );
      }
    }

    // R5 CLI: Unknown CLI flag, 0-match --scope, 0-match --feature, and --expect-count mismatch must exit 1
    for (const [r5BadLabel, r5BadArgs] of [
      ['unknown-flag', ['--unknown-bogus-flag']],
      ['nonmatching-scope-live', ['--tier', '3', '--scope', 'nonexistent-scope-xyz']],
      ['nonmatching-feature-live', ['--tier', '3', '--feature', 'F99']],
      ['expect-count-mismatch-list', ['--tier', '3', '--scope', 'sample-pairwise', '--list', '--expect-count', '99']],
      ['expect-count-mismatch-live', ['--tier', '3', '--scope', 'sample-pairwise', '--expect-count', '99']],
    ]) {
      const r5BadRes = await runNodeSubprocess(
        runnerScript,
        r5BadArgs,
        { env: { E2E_TEST_DIR: goodTestsDir, E2E_OUTPUT_DIR: outDir }, quiet: true },
      );
      if (r5BadRes.exitCode === 0) {
        throw new Error(`Expected R5 negative check (${r5BadLabel}) to exit non-zero, got 0`);
      }
    }

    // R5 CLI: Live scoped runs (--tier 3 --scope, --tier 3 --feature, and multi-tier --scope with --expect-count 1) execute only the 1 matching test!
    for (const [r5GoodLabel, r5GoodArgs] of [
      ['tier3-scope', ['--tier', '3', '--scope', 'sample-pairwise', '--expect-count', '1']],
      ['tier3-feature', ['--tier', '3', '--feature', 'F02', '--expect-count', '1']],
      ['multitier-scope', ['--scope', 'sample-pairwise', '--expect-count', '1']],
      ['list-feature-grep', ['--list', '--feature', 'F01', '--grep', 'pairwise tag contract', '--expect-count', '1']],
    ]) {
      const r5GoodRes = await runNodeSubprocess(
        runnerScript,
        r5GoodArgs,
        { env: { E2E_TEST_DIR: goodTestsDir, E2E_OUTPUT_DIR: outDir }, quiet: true },
      );
      if (r5GoodRes.exitCode !== 0) {
        throw new Error(
          `Expected R5 positive check (${r5GoodLabel}) to exit 0, got ${r5GoodRes.exitCode}:\n${r5GoodRes.stdout}\n${r5GoodRes.stderr}`,
        );
      }
    }

    // 7. Stage D: Live Playwright execution of harness-selftest.spec.ts in /usr/bin/google-chrome
    console.log(`[self-test] Stage D: Executing live Playwright harness self-test in Headless Chrome...`);
    const mockBasePort = await getEphemeralPort();
    const mockMobilePort = await getEphemeralPort();

    const liveRes = await runNodeSubprocess(runnerScript, ['--tier', '1'], {
      env: {
        E2E_TEST_DIR: goodTestsDir,
        E2E_OUTPUT_DIR: outDir,
        E2E_BACKEND_BIN: mockBackendPath,
        E2E_MOBILE_DIST_DIR: mobileDistDir,
        E2E_BASE_URL: `http://127.0.0.1:${mockBasePort}`,
        E2E_MOBILE_URL: `http://127.0.0.1:${mockMobilePort}`,
      },
    });
    if (liveRes.exitCode !== 0) {
      throw new Error(`Stage D live Playwright harness self-test failed with code ${liveRes.exitCode}`);
    }

    console.log(`\n[self-test] ALL E2E-M1 & E2E-S (R1-R5) CLI & HARNESS SELF-TESTS PASSED!`);
    return 0;
  } finally {
    fs.rmSync(tmpSelfDir, { recursive: true, force: true });
  }
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));

  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  if (opts.selfTest) {
    const code = await handleSelfTest();
    process.exit(code);
  }

  let envInfo;
  try {
    envInfo = ensureRunnerFixtureAndSafetyEnv(opts);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (opts.printEnv) {
    printResolvedEnvBanner(envInfo);
    process.exit(0);
  }

  if (opts.dryCheck) {
    if (opts.scope || opts.feature || opts.testId || opts.grep) {
      const code = await handleScopedDryCheck(opts);
      process.exit(code);
    }
    const code = await handleUnscopedDryCheck();
    process.exit(code);
  }

  if (opts.list) {
    const code = await handleListMode(opts);
    process.exit(code);
  }

  if (opts.tier !== null) {
    const code = await handleSingleTierMode(opts.tier, opts, envInfo);
    process.exit(code);
  }

  const code = await handleFullSuiteMode(opts, envInfo);
  process.exit(code);
}

main().catch((err) => {
  console.error(`[run-e2e] Fatal unhandled error:`, err);
  process.exit(1);
});
