import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  E2E_PATHS,
  ensureStackReady,
  createApiClient,
  unwrapList,
} from '../../harness';

function runGit(args: string[]): string {
  return execFileSync('git', args, {
    cwd: E2E_PATHS.workspaceRoot,
    encoding: 'utf8',
  });
}

function checkGitIgnore(relPath: string): { ignored: boolean; output: string } {
  try {
    const out = execFileSync('git', ['check-ignore', '-v', relPath], {
      cwd: E2E_PATHS.workspaceRoot,
      encoding: 'utf8',
    });
    return { ignored: true, output: out.trim() };
  } catch (err: any) {
    return {
      ignored: false,
      output: String(err?.stdout || err?.stderr || '').trim(),
    };
  }
}

function resolveAnyRoot(relPath: string): string {
  const inApp = path.join(E2E_PATHS.repoRoot, relPath);
  if (fs.existsSync(inApp)) return inApp;
  return path.join(E2E_PATHS.workspaceRoot, relPath);
}

test.describe('Area A Tier 1 — Repository Hygiene, Infrastructure, Migrations & Seeds (F01..F04)', () => {
  // =========================================================================
  // Feature F01: Legacy personal-system/ Removal & hermes/ Absence (5 tests)
  // =========================================================================

  test(
    '[T1][F01] Legacy personal-system directory is completely removed from disk and git index',
    { tag: ['@tier1', '@F01'] },
    async () => {
      const legacyDir = path.join(E2E_PATHS.repoRoot, 'personal-system');
      expect(fs.existsSync(legacyDir)).toBe(false);

      const tracked = runGit(['ls-files', 'personal-system/']).trim();
      expect(tracked).toBe('');
    },
  );

  test(
    '[T1][F01] Legacy Python hermes stub directory and files remain absent',
    { tag: ['@tier1', '@F01'] },
    async () => {
      const hermesDir = path.join(E2E_PATHS.repoRoot, 'hermes');
      const hermesReadme = path.join(E2E_PATHS.repoRoot, 'hermes', 'README.md');
      const hermesMain = path.join(E2E_PATHS.repoRoot, 'hermes', 'main.py');

      expect(fs.existsSync(hermesDir)).toBe(false);
      expect(fs.existsSync(hermesReadme)).toBe(false);
      expect(fs.existsSync(hermesMain)).toBe(false);

      const tracked = runGit(['ls-files', 'hermes/']).trim();
      expect(tracked).toBe('');
    },
  );

  test(
    '[T1][F01] Python crawlers suite (youtube-lists, youtube-ai, youtube-clean, template_crawler) remains intact',
    { tag: ['@tier1', '@F01'] },
    async () => {
      const requiredCrawlerFiles = [
        'crawlers/README.md',
        'crawlers/template_crawler.py',
        'crawlers/youtube-lists/run.sh',
        'crawlers/youtube-lists/migrate.py',
        'crawlers/youtube-lists/youtube-lists.py',
        'crawlers/youtube-lists/cli.py',
        'crawlers/youtube-ai/run.sh',
        'crawlers/youtube-ai/migrate.py',
        'crawlers/youtube-ai/youtube-ai.py',
        'crawlers/youtube-ai/cli.py',
        'crawlers/youtube-clean/run.sh',
        'crawlers/youtube-clean/youtube-clean.py',
        'crawlers/youtube-clean/cli.py',
      ];

      for (const rel of requiredCrawlerFiles) {
        const abs = resolveAnyRoot(rel);
        expect(fs.existsSync(abs), `Expected ${rel} to exist`).toBe(true);
        expect(fs.statSync(abs).size, `Expected ${rel} to be non-empty`).toBeGreaterThan(0);
      }

      const trackedCrawlers = runGit(['ls-files', 'crawlers/'])
        .trim()
        .split('\n')
        .filter(Boolean);
      expect(trackedCrawlers.length).toBeGreaterThanOrEqual(99);
    },
  );

  test(
    '[T1][F01] Operational scripts (download_brain.sh, sync_dropbox.sh, git-hooks/pre-commit) remain intact and executable',
    { tag: ['@tier1', '@F01'] },
    async () => {
      const scriptFiles = [
        'scripts/README.md',
        'scripts/download_brain.sh',
        'scripts/sync_dropbox.sh',
        'scripts/git-hooks/pre-commit',
      ];

      const trackedScripts = runGit(['ls-files', 'scripts/'])
        .trim()
        .split('\n')
        .filter(Boolean);
      for (const rel of scriptFiles) {
        const abs = resolveAnyRoot(rel);
        expect(fs.existsSync(abs), `Expected ${rel} on disk`).toBe(true);
        expect(trackedScripts).toContain(rel);
      }

      for (const execRel of [
        'scripts/download_brain.sh',
        'scripts/sync_dropbox.sh',
        'scripts/git-hooks/pre-commit',
      ]) {
        const abs = resolveAnyRoot(execRel);
        expect(() => fs.accessSync(abs, fs.constants.X_OK)).not.toThrow();
      }
    },
  );

  test(
    '[T1][F01] Standalone sub-systems and authoritative systems-requirements v1.0 specification atlas remain intact',
    { tag: ['@tier1', '@F01'] },
    async () => {
      const subSystemPaths = [
        'sub-systems/README.md',
        'sub-systems/satisfatory-plan/package.json',
        'sub-systems/satisfatory-plan/index.js',
        'sub-systems/auto-players/space-invasion/main.py',
      ];
      for (const rel of subSystemPaths) {
        const abs = resolveAnyRoot(rel);
        expect(fs.existsSync(abs), `Expected ${rel} on disk`).toBe(true);
        expect(fs.statSync(abs).size).toBeGreaterThan(0);
      }

      const trackedSubSystems = runGit(['ls-files', 'sub-systems/'])
        .trim()
        .split('\n')
        .filter(Boolean);
      expect(trackedSubSystems.length).toBeGreaterThanOrEqual(11);

      const specFiles = [
        'README.md',
        '01-architecture-and-tech-stack.md',
        '02-companion-app.md',
        '03-dashboard-life-stats.md',
        '04-hermes-chat-interface.md',
        '05-agent-studio.md',
        '06-ai-mastermind-companion.md',
        '07-todo-list.md',
        '08-routine-planning.md',
        '09-yearly-goals.md',
        '10-course-tracker.md',
        '11-finance-operator.md',
        '12-design-references-and-inspirations.md',
      ];
      for (const doc of specFiles) {
        const abs = path.join(E2E_PATHS.systemsReqDir, doc);
        expect(fs.existsSync(abs), `Expected spec ${doc}`).toBe(true);
        expect(fs.statSync(abs).size).toBeGreaterThan(100);
      }

      const assets = fs
        .readdirSync(E2E_PATHS.assetsDir)
        .filter((f) => f.toLowerCase().endsWith('.jpg'));
      expect(assets.length).toBe(15);
    },
  );

  // =========================================================================
  // Feature F02: Gitignore Traps & data/ Zero-Tracking Hygiene (5 tests)
  // =========================================================================

  test(
    '[T1][F02] git ls-files data/ is completely empty while local data subdirectories exist on disk',
    { tag: ['@tier1', '@F02'] },
    async () => {
      const trackedData = runGit(['ls-files', 'data/']).trim();
      expect(trackedData).toBe('');

      for (const dirRel of [
        'data',
        'data/database',
        'data/knowledge-data',
        'data/second-brain',
      ]) {
        const abs = resolveAnyRoot(dirRel);
        expect(fs.existsSync(abs), `Expected directory ${dirRel} on disk`).toBe(true);
        expect(fs.statSync(abs).isDirectory()).toBe(true);
      }
    },
  );

  test(
    '[T1][F02] .gitignore removes the bare server trap so backend/crates/server files are tracked',
    { tag: ['@tier1', '@F02'] },
    async () => {
      const gitignoreText = fs.readFileSync(
        resolveAnyRoot('.gitignore'),
        'utf8',
      );
      const activeLines = gitignoreText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      expect(activeLines).not.toContain('server');
      expect(activeLines).not.toContain('/server');
      expect(activeLines).not.toContain('server/');

      expect(checkGitIgnore('life-manager/backend/crates/server/Cargo.toml').ignored).toBe(false);
      expect(checkGitIgnore('life-manager/backend/crates/server/src/main.rs').ignored).toBe(false);
    },
  );

  test(
    '[T1][F02] .gitignore ignores .agents/ state metadata and /data/ private vault paths',
    { tag: ['@tier1', '@F02'] },
    async () => {
      const privatePaths = [
        '.agents/teamwork/ORIGINAL_REQUEST.md',
        'data/second-brain/Daily/2026-11-14.md',
        'data/knowledge-data/lists/youtube/test.md',
        'data/database/youtube-lists.sqlite',
      ];

      for (const p of privatePaths) {
        const res = checkGitIgnore(p);
        expect(res.ignored, `Expected ${p} to be ignored by .gitignore`).toBe(true);
        expect(res.output).toContain('.gitignore');
      }
    },
  );

  test(
    '[T1][F02] .gitignore ignores Cargo target, pnpm store, node_modules, Vite dist, Capacitor native, and E2E artifact directories',
    { tag: ['@tier1', '@F02'] },
    async () => {
      const artifactPaths = [
        'target/debug/server',
        'backend/target/release/server',
        'node_modules/.modules.yaml',
        '.pnpm-store/v3/files',
        'apps/web/dist/index.html',
        'apps/mobile/dist/index.html',
        'packages/ui/dist/index.js',
        'apps/mobile/android/app',
        'apps/mobile/ios/App',
        'e2e/node_modules/@playwright/test',
        'e2e/test-results/run.json',
        'e2e/playwright-report/index.html',
      ];

      for (const p of artifactPaths) {
        expect(
          checkGitIgnore(p).ignored,
          `Expected artifact path ${p} to be ignored`,
        ).toBe(true);
      }
    },
  );

  test(
    '[T1][F02] git status --porcelain reports zero untracked or staged files under data/ and .agents/',
    { tag: ['@tier1', '@F02'] },
    async () => {
      const statusOut = runGit(['status', '--porcelain', '--', 'data/', '.agents/']).trim();
      expect(statusOut).toBe('');
    },
  );

  // =========================================================================
  // Feature F03: Docs, mise.toml, .env.example & Unified Podman Stack (5 tests)
  // =========================================================================

  test(
    '[T1][F03] AGENTS.md, CLAUDE.md, and README.md document the Rust 4-crate backend, React CSR Web SPA, Capacitor Mobile Companion, and hermes gateway',
    { tag: ['@tier1', '@F03'] },
    async () => {
      for (const docName of ['AGENTS.md', 'CLAUDE.md', 'README.md']) {
        const content = fs.readFileSync(resolveAnyRoot(docName), 'utf8');
        expect(content.length).toBeGreaterThan(500);
        expect(content).toContain('domain');
        expect(content).toContain('life-ops');
        expect(content).toContain('intelligence');
        expect(content).toContain('server');
        expect(content).toContain('packages/ui');
        expect(content).toContain('packages/api-client');
        expect(content).toContain('apps/web');
        expect(content).toContain('apps/mobile');
        expect(content).toContain('8642');
        expect(content).toContain('/mcp');
        expect(content).toContain('pnpm@10.34.7');
        expect(content).toContain('data/');
      }
    },
  );

  test(
    '[T1][F03] mise.toml specifies rust = "stable", node = "24", and pnpm = "10.34.7"',
    { tag: ['@tier1', '@F03'] },
    async () => {
      const miseContent = fs.readFileSync(
        path.join(E2E_PATHS.repoRoot, 'mise.toml'),
        'utf8',
      );
      expect(miseContent).toContain('[tools]');
      expect(miseContent).toContain('rust = "stable"');
      expect(miseContent).toContain('node = "24"');
      expect(miseContent).toContain('pnpm = "10.34.7"');
      expect(miseContent).not.toMatch(/^\s*go\s*=/m);
    },
  );

  test(
    '[T1][F03] .env.example defines all HERMES // OS backend/gateway keys while preserving 100% of crawler and script keys',
    { tag: ['@tier1', '@F03'] },
    async () => {
      const envExample = fs.readFileSync(
        resolveAnyRoot('.env.example'),
        'utf8',
      );
      const envMap = new Map<string, string>();
      for (const rawLine of envExample.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0) {
          envMap.set(line.slice(0, eqIdx).trim(), line.slice(eqIdx + 1).trim());
        }
      }

      // HERMES // OS runtime & auth keys
      expect(envMap.get('PORT')).toBe('8080');
      expect(envMap.get('STATIC_DIST_DIR')).toBe('../apps/web/dist');
      expect(envMap.get('SECOND_BRAIN_DIR')).toBe('data/second-brain');
      expect(envMap.get('HERMES_ADMIN_USER')).toBe('operator');
      expect(envMap.get('HERMES_ADMIN_PASSWORD')).toBe('hermes-os-local');
      expect(envMap.has('HERMES_BOOTSTRAP_PAT')).toBe(true);
      expect(envMap.get('REQUIRE_WEB_LOGIN')).toBe('false');
      expect(envMap.get('DATABASE_URL')).toBe(
        'postgres://hermes:hermes@127.0.0.1:5432/hermes_os',
      );
      expect(envMap.get('REDIS_URL')).toBe('redis://127.0.0.1:6379');
      expect(envMap.get('HERMES_GATEWAY_URL')).toBe('http://127.0.0.1:8642/v1');
      expect(envMap.has('HERMES_API_KEY')).toBe(true);

      // Preserved crawler & sync script keys
      for (const preservedKey of [
        'OBSIDIAN_BRAIN_REPO_URL',
        'YOUTUBE_COOKIES_BROWSER',
        'YOUTUBE_LISTS_DB',
        'YOUTUBE_LISTS_NOTES_DIR',
        'GEMINI_API_KEY',
        'DROPBOX_REMOTE',
        'DROPBOX_PATH',
      ]) {
        expect(
          envMap.has(preservedKey),
          `Expected .env.example to preserve ${preservedKey}`,
        ).toBe(true);
      }
      expect(envMap.get('YOUTUBE_LISTS_DB')).toContain('data/database/youtube-lists.sqlite');
      expect(envMap.get('YOUTUBE_LISTS_NOTES_DIR')).toContain(
        'data/knowledge-data/lists/youtube',
      );
    },
  );

  test(
    '[T1][F03] podman-compose.yml and infra-deploy/ define pgvector:pg16, redis:7-alpine, 01-pgvector.sql, and unified multi-stage Dockerfile',
    { tag: ['@tier1', '@F03'] },
    async () => {
      for (const composeRel of ['podman-compose.yml', 'infra-deploy/podman-compose.yml']) {
        const composeText = fs.readFileSync(
          resolveAnyRoot(composeRel),
          'utf8',
        );
        expect(composeText).toContain('pgvector/pgvector:pg16');
        expect(composeText).toContain('redis:7-alpine');
        expect(composeText).toContain('hermes-server');
        expect(composeText).toContain('/app/apps/web/dist');
        // The root stack runs hermes-server on the host network (to reach the Hermes API on
        // 127.0.0.1:8642), so it sets PORT instead of publishing a port.
        expect(composeText).toMatch(/8080\}?:8080|PORT: \$\{HERMES_SERVER_PORT:-8080\}/);
        expect(composeText).toContain('01-pgvector.sql');
      }

      const dockerfile = fs.readFileSync(
        path.join(E2E_PATHS.repoRoot, 'infra-deploy', 'Dockerfile'),
        'utf8',
      );
      expect(dockerfile).toContain('AS web-builder');
      expect(dockerfile).toContain('corepack pnpm@10.34.7');
      expect(dockerfile).toContain('AS rust-builder');
      expect(dockerfile).toContain('cargo build --release --bin server');
      expect(dockerfile).toContain('AS runtime');
      expect(dockerfile).toContain('/app/apps/web/dist');

      const initSql = fs.readFileSync(
        path.join(E2E_PATHS.repoRoot, 'infra-deploy', 'initdb', '01-pgvector.sql'),
        'utf8',
      );
      expect(initSql).toContain('CREATE EXTENSION IF NOT EXISTS vector;');
    },
  );

  test(
    '[T1][F03] Root package.json, pnpm-workspace.yaml, .npmrc, and tsconfig.base.json lock pnpm@10.34.7 and TypeScript ~5.8.3',
    { tag: ['@tier1', '@F03'] },
    async () => {
      const rootPkg = JSON.parse(
        fs.readFileSync(path.join(E2E_PATHS.repoRoot, 'package.json'), 'utf8'),
      );
      expect(rootPkg.packageManager).toBe('pnpm@10.34.7');
      expect(rootPkg.devDependencies?.typescript).toBe('~5.8.3');

      const pnpmWs = fs.readFileSync(
        path.join(E2E_PATHS.repoRoot, 'pnpm-workspace.yaml'),
        'utf8',
      );
      expect(pnpmWs).toContain('apps/*');
      expect(pnpmWs).toContain('packages/*');

      const npmrc = fs.readFileSync(path.join(E2E_PATHS.repoRoot, '.npmrc'), 'utf8');
      expect(npmrc).toContain('registry=https://registry.npmjs.org/');

      const tsconfigBase = JSON.parse(
        fs.readFileSync(path.join(E2E_PATHS.repoRoot, 'tsconfig.base.json'), 'utf8'),
      );
      expect(tsconfigBase.compilerOptions?.strict).toBe(true);
    },
  );

  // =========================================================================
  // Feature F04: Multi-Crate Rust Workspace & SQLx pgvector Migrations + Seeds (5 tests)
  // =========================================================================

  test(
    '[T1][F04] Rust workspace Cargo.toml and all 4 member crates (domain, life-ops, intelligence, server) use edition 2024 and resolver 3',
    { tag: ['@tier1', '@F04'] },
    async () => {
      const rootCargo = fs.readFileSync(
        path.join(E2E_PATHS.repoRoot, 'backend', 'Cargo.toml'),
        'utf8',
      );
      expect(rootCargo).toContain('resolver = "3"');
      expect(rootCargo).toContain('edition = "2024"');
      for (const member of [
        '"crates/domain"',
        '"crates/life-ops"',
        '"crates/intelligence"',
        '"crates/server"',
      ]) {
        expect(rootCargo).toContain(member);
      }

      const expectedCrates: Array<{ dir: string; pkgName: string; hasBin?: boolean }> = [
        { dir: 'domain', pkgName: 'hermes-domain' },
        { dir: 'life-ops', pkgName: 'hermes-life-ops' },
        { dir: 'intelligence', pkgName: 'hermes-intelligence' },
        { dir: 'server', pkgName: 'hermes-server', hasBin: true },
      ];

      for (const c of expectedCrates) {
        const cargoToml = fs.readFileSync(
          path.join(E2E_PATHS.repoRoot, 'backend', 'crates', c.dir, 'Cargo.toml'),
          'utf8',
        );
        expect(cargoToml).toContain(`name = "${c.pkgName}"`);
        expect(
          cargoToml.includes('edition.workspace = true') ||
            cargoToml.includes('edition = "2024"'),
        ).toBe(true);
        if (c.hasBin) {
          expect(cargoToml).toContain('[[bin]]');
          expect(cargoToml).toContain('name = "server"');
        }
      }
    },
  );

  test(
    '[T1][F04] SQLx migrations in backend/migrations/ define pgvector extension, all 01..11 domain tables, and 8-table sync_change_log triggers',
    { tag: ['@tier1', '@F04'] },
    async () => {
      const migrationsDir = path.join(E2E_PATHS.repoRoot, 'backend', 'migrations');
      const sqlFiles = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      expect(sqlFiles.length).toBeGreaterThanOrEqual(3);

      const combinedSql = sqlFiles
        .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
        .join('\n');

      expect(combinedSql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+vector/i);

      const requiredTables = [
        'vault_embeddings',
        'users',
        'web_sessions',
        'api_tokens',
        'companion_offline_phrases',
        'sync_change_log',
        'dashboards',
        'dashboard_widgets',
        'server_nodes',
        'hermes_sessions_index',
        'pending_mcp_approvals',
        'mcp_undo_actions',
        'agents',
        'agent_triggers',
        'agent_runs',
        'projects',
        'tasks',
        'time_sessions',
        'routines',
        'routine_items',
        'routine_logs',
        'daily_checkins',
        'ideal_week_blocks',
        'yearly_cycles',
        'goals',
        'goal_key_results',
        'goal_checkins',
        'courses',
        'course_modules',
        'course_lessons',
        'portfolio_assets',
        'monthly_investment_plans',
        'retirement_config',
        'portfolio_snapshots',
      ];

      for (const tbl of requiredTables) {
        const re = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${tbl}\\b`, 'i');
        expect(combinedSql, `Expected migration DDL for table ${tbl}`).toMatch(re);
      }

      // Verify all 8 mobile sync triggers
      for (const trig of [
        'trg_sync_projects',
        'trg_sync_tasks',
        'trg_sync_time_sessions',
        'trg_sync_routines',
        'trg_sync_routine_items',
        'trg_sync_routine_logs',
        'trg_sync_daily_checkins',
        'trg_sync_companion_offline_phrases',
      ]) {
        expect(combinedSql).toContain(trig);
      }
    },
  );

  test(
    '[T1][F04] Starter seed data populates the 4 Room Monitor Decks (DECK_01..DECK_04) via GET /api/dashboards',
    { tag: ['@tier1', '@F04'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const res = await api.get('/api/dashboards');
      expect(res.status).toBe(200);

      const decks = unwrapList<Record<string, any>>(res, ['dashboards']);
      expect(decks.length).toBeGreaterThanOrEqual(4);

      const expectedDecks = [
        { slug: 'tactical-ops', titleToken: 'TACTICAL' },
        { slug: 'wealth-fire', titleToken: 'WEALTH' },
        { slug: 'strategy-lore', titleToken: 'STRATEGY' },
        { slug: 'infra-knights', titleToken: 'INFRA' },
      ];

      for (const expected of expectedDecks) {
        const match = decks.find((d) => d.slug === expected.slug);
        expect(match, `Expected seeded deck slug=${expected.slug}`).toBeDefined();
        expect(String(match!.title).toUpperCase()).toContain(expected.titleToken);
        expect(Number(match!.cycle_seconds)).toBeGreaterThan(0);
        expect(Number(match!.layout_cols)).toBe(12);
        expect(Number(match!.layout_rows)).toBe(8);
      }
    },
  );

  test(
    '[T1][F04] Starter seed data populates the 4 Starter Order of Knights via GET /api/agents',
    { tag: ['@tier1', '@F04'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const res = await api.get('/api/agents');
      expect(res.status).toBe(200);

      const agents = unwrapList<Record<string, any>>(res, ['agents']);
      expect(agents.length).toBeGreaterThanOrEqual(4);

      const expectedKnights = [
        { slug: 'sir-chronos', nameToken: 'Sir Chronos', archetype: 'paladin' },
        { slug: 'vanguard-aurum', nameToken: 'Vanguard Aurum', archetype: 'vanguard' },
        { slug: 'lore-warden-lyra', nameToken: 'Lore-Warden Lyra', archetype: 'lore_warden' },
        { slug: 'inquisitor-vex', nameToken: 'Inquisitor Vex', archetype: 'inquisitor' },
      ];

      for (const expected of expectedKnights) {
        const knight = agents.find((a) => a.slug === expected.slug);
        expect(knight, `Expected seeded Knight slug=${expected.slug}`).toBeDefined();
        expect(String(knight!.name)).toContain(expected.nameToken);
        expect(knight!.knight_archetype).toBe(expected.archetype);
        expect(Number(knight!.monthly_budget_cents)).toBeGreaterThan(0);
        expect(String(knight!.system_prompt || '').length).toBeGreaterThan(10);
        expect(knight!.grid_pos).toBeDefined();
        expect(typeof knight!.grid_pos.x).toBe('number');
        expect(typeof knight!.grid_pos.y).toBe('number');
      }
    },
  );

  test(
    '[T1][F04] Starter seed data populates default Frieren companion_offline_phrases and singleton retirement_config',
    { tag: ['@tier1', '@F04'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();

      const phrasesRes = await api.get('/api/companion/phrases');
      expect(phrasesRes.status).toBe(200);
      const phrases = unwrapList<Record<string, any>>(phrasesRes, ['phrases']);
      expect(phrases.length).toBeGreaterThanOrEqual(6);
      for (const p of phrases) {
        const text = String(p.phrase_text ?? p.text ?? '');
        expect(text.length).toBeGreaterThan(10);
      }

      const retRes = await api.get('/api/finance/retirement');
      expect(retRes.status).toBe(200);
      const cfg =
        retRes.json?.config ?? retRes.json?.retirement_config ?? retRes.json;
      expect(cfg).toBeDefined();
      expect(Number(cfg.expected_real_return_pct)).toBeGreaterThan(0);
      expect(Number(cfg.safe_withdrawal_rate_pct)).toBeGreaterThan(0);
    },
  );
});
