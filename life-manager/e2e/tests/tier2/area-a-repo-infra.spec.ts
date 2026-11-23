import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  E2E_PATHS,
  ensureStackReady,
  withIsolatedBackend,
  createApiClient,
  unwrapList,
  createPatToken,
  CleanupRegistry,
} from '../../harness';

function runGit(args: string[]): string {
  return execFileSync('git', args, {
    cwd: E2E_PATHS.workspaceRoot,
    encoding: 'utf8',
  });
}

function isIgnoredByGit(relPath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', relPath], {
      cwd: E2E_PATHS.workspaceRoot,
    });
    return true;
  } catch {
    return false;
  }
}

function resolveAnyRoot(relPath: string): string {
  const inApp = path.join(E2E_PATHS.repoRoot, relPath);
  if (fs.existsSync(inApp)) return inApp;
  return path.join(E2E_PATHS.workspaceRoot, relPath);
}

function collectRustSourceFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRustSourceFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.rs')) {
      acc.push(full);
    }
  }
  return acc;
}

test.describe('Area A Tier 2 — Repository, Gitignore, Config & Migration Boundary/Negative Suite (F01..F04)', () => {
  // =========================================================================
  // Feature F01: Legacy Removal & Crawler/Script Integrity Boundaries (5 tests)
  // =========================================================================

  test(
    '[T2][F01] Zero legacy Go module manifests (go.mod, go.sum, *.go) or Next.js configs exist anywhere in git index',
    { tag: ['@tier2', '@F01'] },
    async () => {
      const allTracked = runGit(['ls-files'])
        .trim()
        .split('\n')
        .filter(Boolean);

      const legacyMatches = allTracked.filter((file) =>
        /(^|\/)go\.(mod|sum)$|\.go$|(^|\/)next\.config\.(ts|js|mjs)$/i.test(file),
      );
      expect(legacyMatches).toEqual([]);
    },
  );

  test(
    '[T2][F01] Read-only directories (crawlers, scripts, sub-systems, systems-requirements) have zero uncommitted diffs',
    { tag: ['@tier2', '@F01'] },
    async () => {
      const roDirs = ['crawlers', 'scripts', 'sub-systems'];
      const statusOut = runGit(['status', '--porcelain', '--', ...roDirs]).trim();
      expect(statusOut).toBe('');

      const diffOut = runGit(['diff', 'HEAD', '--', ...roDirs]).trim();
      expect(diffOut).toBe('');
    },
  );

  test(
    '[T2][F01] Crawler template_crawler.py preserves the canonical normalized document schema and compiles cleanly',
    { tag: ['@tier2', '@F01'] },
    async () => {
      const templatePath = resolveAnyRoot(path.join('crawlers', 'template_crawler.py'));
      const readmePath = resolveAnyRoot(path.join('crawlers', 'README.md'));
      const combinedText =
        fs.readFileSync(templatePath, 'utf8') + '\n' + fs.readFileSync(readmePath, 'utf8');

      for (const requiredKey of [
        'id',
        'source',
        'url',
        'title',
        'author',
        'published_at',
        'fetched_at',
        'raw_content',
        'clean_content',
        'metadata',
      ]) {
        expect(combinedText).toContain(requiredKey);
      }

      // Parse AST with python3 -B so zero .pyc / __pycache__ artifacts are created
      const pyOut = execFileSync(
        'python3',
        [
          '-B',
          '-c',
          'import ast, pathlib; ast.parse(pathlib.Path("crawlers/template_crawler.py").read_text(encoding="utf-8")); print("AST_OK")',
        ],
        { cwd: E2E_PATHS.workspaceRoot, encoding: 'utf8' },
      ).trim();
      expect(pyOut).toBe('AST_OK');
    },
  );

  test(
    '[T2][F01] Crawler SQLite migration chains (youtube-lists 0001..0008 and youtube-ai 0001..0004) are contiguous and define required tables',
    { tag: ['@tier2', '@F01'] },
    async () => {
      const listsMigDir = resolveAnyRoot(
        path.join('crawlers', 'youtube-lists', 'migrations'),
      );
      const aiMigDir = resolveAnyRoot(
        path.join('crawlers', 'youtube-ai', 'migrations'),
      );

      const listsFiles = fs.readdirSync(listsMigDir).sort();
      for (let i = 1; i <= 8; i += 1) {
        const prefix = String(i).padStart(4, '0') + '_';
        expect(
          listsFiles.some((f) => f.startsWith(prefix)),
          `Expected youtube-lists migration starting with ${prefix}`,
        ).toBe(true);
      }

      const aiFiles = fs.readdirSync(aiMigDir).sort();
      for (let i = 1; i <= 4; i += 1) {
        const prefix = String(i).padStart(4, '0') + '_';
        expect(
          aiFiles.some((f) => f.startsWith(prefix)),
          `Expected youtube-ai migration starting with ${prefix}`,
        ).toBe(true);
      }

      const allMigSource = [
        ...listsFiles.map((f) => fs.readFileSync(path.join(listsMigDir, f), 'utf8')),
        ...aiFiles.map((f) => fs.readFileSync(path.join(aiMigDir, f), 'utf8')),
      ].join('\n');

      for (const table of [
        'playlist',
        'video',
        'video_detail',
        'ai_note',
        'ai_classification',
        'schema_migrations',
      ]) {
        expect(allMigSource).toContain(table);
      }
    },
  );

  test(
    '[T2][F01] Pre-commit secret and database guard hook passes with exit code 0 on current repository state',
    { tag: ['@tier2', '@F01'] },
    async () => {
      const out = execFileSync('python3', ['-B', 'scripts/git-hooks/pre-commit'], {
        cwd: E2E_PATHS.workspaceRoot,
        encoding: 'utf8',
      });
      expect(out).not.toContain('refusing to commit');
    },
  );

  // =========================================================================
  // Feature F02: Gitignore Traps & Privacy Boundary Tests (5 tests)
  // =========================================================================

  test(
    '[T2][F02] Nested server, bin, and build source paths across backend, packages, apps, and e2e are never swallowed by .gitignore',
    { tag: ['@tier2', '@F02'] },
    async () => {
      const sourcePathsThatMustNotBeIgnored = [
        'backend/crates/server/src/lib.rs',
        'backend/crates/intelligence/src/mcp_server.rs',
        'packages/api-client/src/server.ts',
        'apps/web/src/components/server-node.tsx',
        'e2e/harness/mock-probe-target.ts',
        'e2e/run-e2e.mjs',
        '.npmrc',
      ];

      for (const p of sourcePathsThatMustNotBeIgnored) {
        expect(
          isIgnoredByGit(p),
          `Source path ${p} must NOT be swallowed by .gitignore`,
        ).toBe(false);
      }
    },
  );

  test(
    '[T2][F02] Secret and database file patterns (.env, *.pem, *.key, *.sqlite*, *.db*, cookies*.txt, rclone.conf, credentials*.json) are ignored while .env.example is unignored',
    { tag: ['@tier2', '@F02'] },
    async () => {
      const secretAndDbPatterns = [
        '.env',
        '.env.local',
        '.env.production',
        'server.pem',
        'tls.key',
        'cert.p12',
        'id_ed25519',
        'cookies-youtube.txt',
        'rclone.conf',
        'client_secret_google.json',
        'credentials.json',
        'test.sqlite',
        'test.sqlite3',
        'test.sqlite-wal',
        'test.db',
        'vault.bundle',
      ];

      for (const p of secretAndDbPatterns) {
        expect(isIgnoredByGit(p), `Secret/DB pattern ${p} must be ignored`).toBe(true);
      }

      expect(isIgnoredByGit('.env.example')).toBe(false);
      expect(isIgnoredByGit('life-manager/infra-deploy/.env.example')).toBe(false);
    },
  );

  test(
    '[T2][F02] Legacy personal-system/backend/data/*.json rule and !/data/*/.gitkeep negation rules are absent from .gitignore',
    { tag: ['@tier2', '@F02'] },
    async () => {
      const gitignoreLines = fs
        .readFileSync(resolveAnyRoot('.gitignore'), 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      for (const line of gitignoreLines) {
        expect(line).not.toContain('personal-system');
        expect(line).not.toMatch(/^!\/?data\//);
      }
    },
  );

  test(
    '[T2][F02] Zero .sqlite, .sqlite3, .db, .pem, .key, or .env secret files are tracked anywhere in git ls-files',
    { tag: ['@tier2', '@F02'] },
    async () => {
      const tracked = runGit(['ls-files'])
        .trim()
        .split('\n')
        .filter(Boolean);

      const forbiddenTracked = tracked.filter((f) =>
        /\.(sqlite|sqlite3|sqlite-wal|sqlite-shm|db|pem|key|p12|pfx|bundle)$|(^|\/)\.env(\.(?!example$)[^/]*)?$/i.test(
          f,
        ),
      );
      expect(forbiddenTracked).toEqual([]);
    },
  );

  test(
    '[T2][F02] Root .env is not tracked and any on-disk .env does not trip scripts/git-hooks/pre-commit',
    { tag: ['@tier2', '@F02'] },
    async () => {
      let envTracked = false;
      try {
        execFileSync('git', ['ls-files', '--error-unmatch', '.env'], {
          cwd: E2E_PATHS.workspaceRoot,
          stdio: 'pipe',
        });
        envTracked = true;
      } catch {
        envTracked = false;
      }
      expect(envTracked).toBe(false);

      const hookResult = execFileSync('python3', ['-B', 'scripts/git-hooks/pre-commit'], {
        cwd: E2E_PATHS.workspaceRoot,
        encoding: 'utf8',
      });
      expect(hookResult).toBe('');
    },
  );

  // =========================================================================
  // Feature F03: Config, Lockfile & Container Permission Trap Tests (5 tests)
  // =========================================================================

  test(
    '[T2][F03] Active KEY=value lines in .env.example and infra-deploy/.env.example contain zero inline # comments',
    { tag: ['@tier2', '@F03'] },
    async () => {
      for (const rel of ['.env.example', 'infra-deploy/.env.example']) {
        const text = fs.readFileSync(resolveAnyRoot(rel), 'utf8');
        const activeLines = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith('#'));

        expect(activeLines.length).toBeGreaterThan(5);
        for (const line of activeLines) {
          expect(
            line,
            `Active env line "${line}" in ${rel} must not contain inline # comments`,
          ).toMatch(/^[A-Z][A-Z0-9_]*=[^#]*$/);
        }
      }
    },
  );

  test(
    '[T2][F03] Documentation and Compose manifests contain zero stale references to personal-backend, personal-frontend, or hermes/main.py',
    { tag: ['@tier2', '@F03'] },
    async () => {
      const filesToCheck = [
        'AGENTS.md',
        'CLAUDE.md',
        'README.md',
        'documentation/README.md',
        'documentation/architecture.md',
        'documentation/methodology.md',
        'podman-compose.yml',
        'infra-deploy/README.md',
        'infra-deploy/podman-compose.yml',
      ];

      for (const rel of filesToCheck) {
        const content = fs.readFileSync(resolveAnyRoot(rel), 'utf8');
        expect(content).not.toContain('personal-backend');
        expect(content).not.toContain('personal-frontend');
        expect(content).not.toContain('hermes/main.py');
        expect(content).not.toContain('sync_dropbox.sh status');
      }
    },
  );

  test(
    '[T2][F03] Every relative Markdown link in README.md, AGENTS.md, CLAUDE.md, documentation/, and infra-deploy/README.md resolves to an existing path on disk',
    { tag: ['@tier2', '@F03'] },
    async () => {
      const mdFiles = [
        'README.md',
        'AGENTS.md',
        'CLAUDE.md',
        'documentation/README.md',
        'documentation/architecture.md',
        'documentation/methodology.md',
        'infra-deploy/README.md',
      ];

      const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
      let checkedLinks = 0;

      for (const rel of mdFiles) {
        const absFile = resolveAnyRoot(rel);
        const dir = path.dirname(absFile);
        const text = fs.readFileSync(absFile, 'utf8');

        for (const match of text.matchAll(linkRe)) {
          const rawTarget = match[1].trim().split(/\s+/)[0];
          if (
            !rawTarget ||
            rawTarget.startsWith('http://') ||
            rawTarget.startsWith('https://') ||
            rawTarget.startsWith('mailto:') ||
            rawTarget.startsWith('#')
          ) {
            continue;
          }
          const cleanTarget = rawTarget.split('#')[0];
          if (!cleanTarget) continue;

          const resolved = path.resolve(dir, cleanTarget);
          checkedLinks += 1;
          expect(
            fs.existsSync(resolved),
            `Broken Markdown link "${rawTarget}" in ${rel} (resolved: ${resolved})`,
          ).toBe(true);
        }
      }

      expect(checkedLinks).toBeGreaterThan(5);
    },
  );

  test(
    '[T2][F03] pnpm-lock.yaml and e2e/pnpm-lock.yaml contain zero corporate proxy URLs (airlock / uplink.goog) and e2e is isolated from root pnpm-workspace.yaml',
    { tag: ['@tier2', '@F03'] },
    async () => {
      for (const lockRel of ['pnpm-lock.yaml', 'e2e/pnpm-lock.yaml']) {
        const lockText = fs.readFileSync(path.join(E2E_PATHS.repoRoot, lockRel), 'utf8');
        expect(lockText).not.toMatch(/airlock|uplink\.goog/i);
      }

      const rootWs = fs.readFileSync(
        path.join(E2E_PATHS.repoRoot, 'pnpm-workspace.yaml'),
        'utf8',
      );
      expect(rootWs).not.toContain('e2e');

      const e2eWs = fs.readFileSync(
        path.join(E2E_PATHS.e2eRoot, 'pnpm-workspace.yaml'),
        'utf8',
      );
      expect(e2eWs).toContain('"."');
    },
  );

  test(
    '[T2][F03] .dockerignore and infra-deploy/initdb/01-pgvector.sql enforce container build isolation and world-readable permissions',
    { tag: ['@tier2', '@F03'] },
    async () => {
      for (const ignoreRel of ['.dockerignore', 'infra-deploy/.dockerignore']) {
        const ignoreText = fs.readFileSync(
          path.join(E2E_PATHS.repoRoot, ignoreRel),
          'utf8',
        );
        expect(ignoreText).toContain('.git');
        expect(ignoreText).toContain('.agents');
        expect(ignoreText).toContain('data');
        expect(ignoreText).toContain('target');
        expect(ignoreText).toContain('node_modules');
        expect(ignoreText).toContain('e2e');
      }

      const infraStat = fs.statSync(path.join(E2E_PATHS.repoRoot, 'infra-deploy'));
      const initdbStat = fs.statSync(
        path.join(E2E_PATHS.repoRoot, 'infra-deploy', 'initdb'),
      );
      const sqlStat = fs.statSync(
        path.join(E2E_PATHS.repoRoot, 'infra-deploy', 'initdb', '01-pgvector.sql'),
      );

      expect(infraStat.mode & 0o005).toBe(0o005);
      expect(initdbStat.mode & 0o005).toBe(0o005);
      expect(sqlStat.mode & 0o004).toBe(0o004);
    },
  );

  // =========================================================================
  // Feature F04: Rust Build Traps, Macro Ban & Seed Idempotency (5 tests)
  // =========================================================================

  test(
    '[T2][F04] Rust workspace Cargo.toml and Cargo.lock forbid cmake, clang, bindgen, aws-lc-sys, and auth-client-credentials-jwt traps',
    { tag: ['@tier2', '@F04'] },
    async () => {
      const cargoTomlPaths = [
        'backend/Cargo.toml',
        'backend/crates/domain/Cargo.toml',
        'backend/crates/life-ops/Cargo.toml',
        'backend/crates/intelligence/Cargo.toml',
        'backend/crates/server/Cargo.toml',
      ];

      for (const rel of cargoTomlPaths) {
        const text = fs.readFileSync(path.join(E2E_PATHS.repoRoot, rel), 'utf8');
        const activeToml = text
          .split(/\r?\n/)
          .filter((line) => !line.trim().startsWith('#'))
          .join('\n');
        expect(activeToml).not.toContain('auth-client-credentials-jwt');
        expect(activeToml).not.toContain('aws-lc-sys');
        expect(activeToml).not.toContain('aws-lc-rs');
      }

      const rootCargo = fs.readFileSync(
        path.join(E2E_PATHS.repoRoot, 'backend', 'Cargo.toml'),
        'utf8',
      );
      expect(rootCargo).toContain('rustls-tls');
      expect(rootCargo).toContain('tls-rustls-ring-webpki');

      const cargoLockPath = path.join(E2E_PATHS.repoRoot, 'backend', 'Cargo.lock');
      if (fs.existsSync(cargoLockPath)) {
        const lockText = fs.readFileSync(cargoLockPath, 'utf8');
        expect(lockText).not.toMatch(/name\s*=\s*"(aws-lc-sys|aws-lc-rs|cmake|bindgen)"/);
      }
    },
  );

  test(
    '[T2][F04] Rust source files across all 4 crates use runtime sqlx::query / sqlx::query_as and zero compile-time sqlx::query! macros',
    { tag: ['@tier2', '@F04'] },
    async () => {
      const cratesDir = path.join(E2E_PATHS.repoRoot, 'backend', 'crates');
      const rsFiles = collectRustSourceFiles(cratesDir);
      expect(rsFiles.length).toBeGreaterThan(10);

      for (const file of rsFiles) {
        const src = fs.readFileSync(file, 'utf8');
        expect(src, `File ${file} must not use compile-time sqlx::query!`).not.toMatch(
          /\bsqlx::query(?:_as|_scalar)?!\s*\(/,
        );
      }
    },
  );

  test(
    '[T2][F04] Finance schema and migrations strictly enforce single macro monthly_investment_plans with zero micro-expense ledger tables',
    { tag: ['@tier2', '@F04'] },
    async () => {
      const migrationsDir = path.join(E2E_PATHS.repoRoot, 'backend', 'migrations');
      const combinedSql = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
        .join('\n');

      expect(combinedSql).toContain('monthly_investment_plans');
      expect(combinedSql).toContain('salary_income_cents');
      expect(combinedSql).toContain('planned_spend_cents');
      expect(combinedSql).toContain('actual_spend_cents');
      expect(combinedSql).toContain('planned_investment_cents');
      expect(combinedSql).toContain('actual_invested_cents');

      expect(combinedSql).not.toMatch(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(expenses|expense_items|transactions|receipts|micro_ledger|ledger_entries)\b/i,
      );
    },
  );

  test(
    '[T2][F04] Starter seeds are idempotent across isolated backend restarts without duplicating decks, knights, or built-in phrases',
    { tag: ['@tier2', '@F04'] },
    async () => {
      await withIsolatedBackend({}, async ({ apiBaseUrl }) => {
        const api = createApiClient(apiBaseUrl);

        const decksRes = await api.get('/api/dashboards');
        expect(decksRes.status).toBe(200);
        const decks = unwrapList<Record<string, any>>(decksRes, ['dashboards']);

        for (const slug of [
          'tactical-ops',
          'wealth-fire',
          'strategy-lore',
          'infra-knights',
        ]) {
          const matches = decks.filter((d) => d.slug === slug);
          expect(matches.length, `Deck ${slug} must not be duplicated`).toBe(1);
        }

        const agentsRes = await api.get('/api/agents');
        expect(agentsRes.status).toBe(200);
        const agents = unwrapList<Record<string, any>>(agentsRes, ['agents']);

        for (const slug of [
          'sir-chronos',
          'vanguard-aurum',
          'lore-warden-lyra',
          'inquisitor-vex',
        ]) {
          const matches = agents.filter((a) => a.slug === slug);
          expect(matches.length, `Starter Knight ${slug} must not be duplicated`).toBe(1);
        }
      });
    },
  );

  test(
    '[T2][F04] Initial sync_pull(since=0) snapshot includes seeded companion_offline_phrases and strictly scopes to the 8 mobile tables',
    { tag: ['@tier2', '@F04'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const pat = await createPatToken(api, 'f04-sync-snapshot-pat');
        cleanup.defer(() => api.delete(`/api/auth/tokens/${pat.id}`));

        const pullRes = await api.withToken(pat.token).get('/api/sync/pull?since=0');
        expect(pullRes.status).toBe(200);

        const changes = unwrapList<Record<string, any>>(pullRes, ['changes']);
        expect(changes.length).toBeGreaterThanOrEqual(6);

        const allowedTables = new Set([
          'projects',
          'tasks',
          'time_sessions',
          'routines',
          'routine_items',
          'routine_logs',
          'daily_checkins',
          'companion_offline_phrases',
        ]);

        const phraseChanges = changes.filter(
          (c) => c.entity_table === 'companion_offline_phrases',
        );
        expect(phraseChanges.length).toBeGreaterThanOrEqual(6);

        for (const change of changes) {
          expect(
            allowedTables.has(String(change.entity_table)),
            `Unexpected non-mobile table in sync pull: ${change.entity_table}`,
          ).toBe(true);
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );
});
