import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  E2E_PATHS,
  E2E_URLS,
  ensureStackReady,
  createApiClient,
  unwrapList,
  createPatToken,
  uniqueId,
  CleanupRegistry,
  waitForAppReady,
} from '../../harness';

test.describe('Area A Tier 1 — Static SPA Serving, OpenAPI 3.1 & Operator Auth/PAT Suite (F05..F07)', () => {
  // =========================================================================
  // Feature F05: Static SPA Serving & SPA Fallback Routing (5 tests)
  // =========================================================================

  test(
    '[T1][F05] Root GET / on :8080 serves compiled apps/web/dist/index.html with 200 OK and text/html Content-Type',
    { tag: ['@tier1', '@F05'] },
    async () => {
      await ensureStackReady();
      const res = await fetch(`${E2E_URLS.baseUrl}/`, {
        headers: { Accept: 'text/html' },
      });
      expect(res.status).toBe(200);

      const contentType = res.headers.get('content-type') || '';
      expect(contentType).toMatch(/text\/html/i);

      const html = await res.text();
      expect(html).toMatch(/<!doctype html>/i);
      expect(html).toContain('<div id="root"');
    },
  );

  test(
    '[T1][F05] Hashed static JS and CSS assets referenced by index.html are served with 200 OK and matching MIME types',
    { tag: ['@tier1', '@F05'] },
    async () => {
      await ensureStackReady();
      const indexRes = await fetch(`${E2E_URLS.baseUrl}/`);
      expect(indexRes.status).toBe(200);
      const html = await indexRes.text();

      const scriptSrcs = Array.from(
        html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi),
      ).map((m) => m[1]);
      const styleHrefs = Array.from(
        html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi),
      ).map((m) => m[1]);

      // Fallback to inspecting E2E_PATHS.webDistDir/assets if index.html uses alternate attribute ordering
      if (scriptSrcs.length === 0 && fs.existsSync(path.join(E2E_PATHS.webDistDir, 'assets'))) {
        for (const f of fs.readdirSync(path.join(E2E_PATHS.webDistDir, 'assets'))) {
          if (f.endsWith('.js')) scriptSrcs.push(`/assets/${f}`);
          if (f.endsWith('.css')) styleHrefs.push(`/assets/${f}`);
        }
      }

      expect(scriptSrcs.length).toBeGreaterThanOrEqual(1);

      for (const src of scriptSrcs) {
        const assetUrl = src.startsWith('http')
          ? src
          : `${E2E_URLS.baseUrl}${src.startsWith('/') ? '' : '/'}${src}`;
        const jsRes = await fetch(assetUrl);
        expect(jsRes.status, `Expected 200 for JS asset ${src}`).toBe(200);
        expect(jsRes.headers.get('content-type') || '').toMatch(/javascript/i);
        const jsText = await jsRes.text();
        expect(jsText.length).toBeGreaterThan(50);
      }

      for (const href of styleHrefs) {
        const cssUrl = href.startsWith('http')
          ? href
          : `${E2E_URLS.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
        const cssRes = await fetch(cssUrl);
        expect(cssRes.status, `Expected 200 for CSS asset ${href}`).toBe(200);
        expect(cssRes.headers.get('content-type') || '').toMatch(/text\/css/i);
      }
    },
  );

  test(
    '[T1][F05] Direct deep-link GET requests to all 9 primary Web SPA routes return 200 OK with SPA index.html fallback',
    { tag: ['@tier1', '@F05'] },
    async () => {
      await ensureStackReady();
      const primaryRoutes = [
        '/dashboard',
        '/monitor',
        '/hermes',
        '/agents',
        '/todos',
        '/routines',
        '/goals',
        '/courses',
        '/finance',
      ];

      for (const route of primaryRoutes) {
        const res = await fetch(`${E2E_URLS.baseUrl}${route}`, {
          headers: { Accept: 'text/html' },
        });
        expect(res.status, `Expected 200 OK for deep link ${route}`).toBe(200);
        expect(res.headers.get('content-type') || '').toMatch(/text\/html/i);
        const body = await res.text();
        expect(body).toContain('<div id="root"');
      }
    },
  );

  test(
    '[T1][F05] Nested client-side deep links and query parameters fall back to 200 OK SPA index.html',
    { tag: ['@tier1', '@F05'] },
    async () => {
      await ensureStackReady();
      const nestedLinks = [
        '/dashboard/tactical-ops',
        '/monitor?deck=wealth-fire&pinned=1',
        '/goals/cycles/2026',
        '/courses/rust-2024/lessons/1',
        '/unknown-client-deep-link',
      ];

      for (const link of nestedLinks) {
        const res = await fetch(`${E2E_URLS.baseUrl}${link}`, {
          headers: { Accept: 'text/html' },
        });
        expect(res.status, `Expected 200 OK for nested link ${link}`).toBe(200);
        expect(res.headers.get('content-type') || '').toMatch(/text\/html/i);
        const html = await res.text();
        expect(html).toContain('<div id="root"');
      }
    },
  );

  test(
    '[T1][F05] Playwright browser navigation directly to deep links (/dashboard and /monitor) mounts the 100% CSR React SPA with zero SSR hydration artifacts',
    { tag: ['@tier1', '@F05'] },
    async ({ page }) => {
      await ensureStackReady();

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
      expect(await page.locator('#root > *').count()).toBeGreaterThan(0);
      const dashboardHtml = await page.content();
      expect(dashboardHtml).not.toContain('__NEXT_DATA__');
      expect(dashboardHtml).not.toContain('next-route-announcer');

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/monitor`);
      expect(await page.locator('#root > *').count()).toBeGreaterThan(0);
      const monitorHtml = await page.content();
      expect(monitorHtml).not.toContain('__NEXT_DATA__');
      expect(monitorHtml).not.toContain('next-route-announcer');
    },
  );

  // =========================================================================
  // Feature F06: utoipa OpenAPI 3.1 Schema & packages/api-client Parity (5 tests)
  // =========================================================================

  test(
    '[T1][F06] GET /api/openapi.json returns 200 OK with valid OpenAPI 3.1.x specification metadata',
    { tag: ['@tier1', '@F06'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const res = await api.get('/api/openapi.json');

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type') || '').toMatch(/application\/json/i);
      expect(String(res.json?.openapi || '')).toMatch(/^3\.1\.\d+$/);
      expect(typeof res.json?.info?.title).toBe('string');
      expect(res.json.info.title.length).toBeGreaterThan(0);
      expect(res.json?.info?.version).toBe('1.0.0');
    },
  );

  test(
    '[T1][F06] OpenAPI 3.1 paths object documents endpoints across all HERMES // OS REST domains',
    { tag: ['@tier1', '@F06'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const res = await api.get('/api/openapi.json');
      expect(res.status).toBe(200);

      const pathsObj = (res.json?.paths || {}) as Record<string, unknown>;
      const pathKeys = Object.keys(pathsObj);

      const requiredDomainPaths = [
        '/api/health',
        '/api/auth/verify',
        '/api/auth/login',
        '/api/auth/tokens',
        '/api/auth/pairing-qr',
        '/api/sync/push',
        '/api/sync/pull',
        '/api/dashboards',
        '/api/telemetry/life-score',
        '/api/servers',
        '/api/hermes/sessions',
        '/api/companion/phrases',
        '/api/mcp/approvals',
        '/api/vault/notes',
        '/api/agents',
        '/api/agent-runs',
        '/api/projects',
        '/api/tasks',
        '/api/time/timer',
        '/api/routines',
        '/api/ideal-week',
        '/api/weekly-review/summary',
        '/api/goals',
        '/api/goals/cycles',
        '/api/courses',
        '/api/courses/spaced-reviews/due',
        '/api/finance/assets',
        '/api/finance/allocation',
        '/api/finance/monthly-plans',
        '/api/finance/retirement',
      ];

      for (const expectedPath of requiredDomainPaths) {
        expect(
          pathKeys,
          `Expected OpenAPI paths to document ${expectedPath}`,
        ).toContain(expectedPath);
      }
    },
  );

  test(
    '[T1][F06] OpenAPI components.schemas defines domain DTOs and reconciled enums (TaskStatus, EnergyLevel, ApiError)',
    { tag: ['@tier1', '@F06'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const res = await api.get('/api/openapi.json');
      expect(res.status).toBe(200);

      const schemas = (res.json?.components?.schemas || {}) as Record<string, any>;
      expect(Object.keys(schemas).length).toBeGreaterThanOrEqual(20);

      const serializedSchemas = JSON.stringify(schemas);

      // Reconciled TaskStatus enum values
      for (const statusVal of [
        'inbox',
        'backlog',
        'todo',
        'in_progress',
        'review',
        'done',
        'canceled',
      ]) {
        expect(serializedSchemas).toContain(`"${statusVal}"`);
      }

      // Reconciled EnergyLevel enum values
      for (const energyVal of ['deep', 'shallow', 'quick']) {
        expect(serializedSchemas).toContain(`"${energyVal}"`);
      }

      // Widget source_kind enum values
      for (const widgetKind of ['builtin', 'command', 'http', 'sql', 'hermes']) {
        expect(serializedSchemas).toContain(`"${widgetKind}"`);
      }

      // Error schema fields
      expect(serializedSchemas).toContain('"error"');
      expect(serializedSchemas).toContain('"message"');
    },
  );

  test(
    '[T1][F06] packages/api-client exports typed SDK helpers and stays in parity with /api/openapi.json',
    { tag: ['@tier1', '@F06'] },
    async () => {
      await ensureStackReady();
      const apiClientPkgPath = path.join(
        E2E_PATHS.repoRoot,
        'packages',
        'api-client',
        'package.json',
      );
      const apiClientIndexPath = path.join(
        E2E_PATHS.repoRoot,
        'packages',
        'api-client',
        'src',
        'index.ts',
      );

      expect(fs.existsSync(apiClientPkgPath)).toBe(true);
      expect(fs.existsSync(apiClientIndexPath)).toBe(true);

      const pkgJson = JSON.parse(fs.readFileSync(apiClientPkgPath, 'utf8'));
      expect(pkgJson.name).toBe('@hermes/api-client');

      const indexSource = fs.readFileSync(apiClientIndexPath, 'utf8');
      expect(indexSource).toContain('createApiHeaders');
      expect(indexSource).toContain('createMutationId');
      expect(indexSource).toContain('HealthStatusResponse');

      const snapshotOpenApiPath = path.join(
        E2E_PATHS.repoRoot,
        'packages',
        'api-client',
        'openapi.json',
      );
      if (fs.existsSync(snapshotOpenApiPath)) {
        const diskSpec = JSON.parse(fs.readFileSync(snapshotOpenApiPath, 'utf8'));
        const liveRes = await createApiClient().get('/api/openapi.json');
        expect(liveRes.status).toBe(200);
        expect(diskSpec.openapi).toBe(liveRes.json.openapi);
        expect(Object.keys(diskSpec.paths || {}).sort()).toEqual(
          Object.keys(liveRes.json.paths || {}).sort(),
        );
      }
    },
  );

  test(
    '[T1][F06] @hermes/api-client passes TypeScript typechecking cleanly',
    { tag: ['@tier1', '@F06'] },
    async () => {
      execFileSync(
        'corepack',
        ['pnpm@10.34.7', '--filter', '@hermes/api-client', 'typecheck'],
        {
          cwd: E2E_PATHS.repoRoot,
          encoding: 'utf8',
        },
      );
    },
  );

  // =========================================================================
  // Feature F07: Operator Auth, SHA-256 PATs (plm_pat_...) & Pairing QR (5 tests)
  // =========================================================================

  test(
    '[T1][F07] GET /api/health returns 200 OK with status, db_online, redis_online, hermes_gateway, and version 1.0.0',
    { tag: ['@tier1', '@F07'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const res = await api.get('/api/health');

      expect(res.status).toBe(200);
      expect(res.json.status).toBe('ok');
      expect(res.json.db_online).toBe(true);
      expect(res.json.redis_online).toBe(true);
      expect(['online', 'offline_mock']).toContain(res.json.hermes_gateway);
      expect(res.json.version).toBe('1.0.0');
    },
  );

  test(
    '[T1][F07] POST /api/auth/login authenticates operator with argon2id credentials and GET /api/auth/me + POST /api/auth/logout succeed',
    { tag: ['@tier1', '@F07'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();

      const loginRes = await api.post('/api/auth/login', {
        username: process.env.HERMES_ADMIN_USER || 'operator',
        password: process.env.HERMES_ADMIN_PASSWORD || 'hermes-os-local',
      });
      expect(loginRes.status).toBe(200);
      expect(loginRes.json.authenticated).toBe(true);

      const sessionToken =
        loginRes.json.token ?? loginRes.json.session_token ?? '';
      expect(typeof sessionToken).toBe('string');
      expect(sessionToken.length).toBeGreaterThan(8);

      const setCookie = loginRes.headers.get('set-cookie') || '';
      const cookiePair = setCookie.split(';')[0]?.trim() || '';
      let authedApi = api.withToken(sessionToken);
      if (cookiePair) {
        authedApi = authedApi.withCookie(cookiePair);
      }

      const meRes = await authedApi.get('/api/auth/me');
      expect(meRes.status).toBe(200);
      const username = meRes.json?.user?.username ?? meRes.json?.username;
      expect(username).toBe('operator');

      const verifyRes = await authedApi.get('/api/auth/verify');
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.json.authenticated).toBe(true);

      const logoutRes = await authedApi.post('/api/auth/logout', {});
      expect([200, 204]).toContain(logoutRes.status);
    },
  );

  test(
    '[T1][F07] POST /api/auth/tokens mints a plm_pat_<32_hex> token and GET /api/auth/verify returns 200 OK with token metadata and latest_server_seq',
    { tag: ['@tier1', '@F07'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const createRes = await api.post('/api/auth/tokens', {
          name: 'Android Companion E2E',
          scopes: ['*'],
        });
        expect([200, 201]).toContain(createRes.status);

        const patId = String(createRes.json.id);
        const patToken = String(createRes.json.token);
        const patPrefix = String(createRes.json.token_prefix);
        cleanup.defer(() => api.delete(`/api/auth/tokens/${patId}`));

        expect(patToken).toMatch(/^plm_pat_[0-9a-f]{32,}$/i);
        expect(patPrefix.startsWith('plm_pat_')).toBe(true);
        expect(patPrefix.length).toBeLessThan(patToken.length);

        const verifyRes = await api.withToken(patToken).get('/api/auth/verify');
        expect(verifyRes.status).toBe(200);
        expect(verifyRes.json.authenticated).toBe(true);
        expect(verifyRes.json.auth_type).toBe('pat');
        expect(verifyRes.json.token_name).toBe('Android Companion E2E');
        expect(Array.isArray(verifyRes.json.scopes)).toBe(true);
        expect(Number.isNaN(Date.parse(String(verifyRes.json.server_time)))).toBe(false);
        expect(typeof verifyRes.json.latest_server_seq).toBe('number');
        expect(verifyRes.json.latest_server_seq).toBeGreaterThanOrEqual(0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F07] GET /api/auth/tokens lists active PAT records and DELETE /api/auth/tokens/{id} revokes the token',
    { tag: ['@tier1', '@F07'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const patName = uniqueId('List-And-Revoke-PAT');
        const pat = await createPatToken(api, patName);
        cleanup.defer(() => api.delete(`/api/auth/tokens/${pat.id}`));

        const listRes = await api.get('/api/auth/tokens');
        expect(listRes.status).toBe(200);
        const tokens = unwrapList<Record<string, any>>(listRes, ['tokens']);
        const found = tokens.find((t) => String(t.id) === pat.id);
        expect(found).toBeDefined();
        expect(found!.name).toBe(patName);
        expect(String(found!.token_prefix)).toMatch(/^plm_pat_/);

        const delRes = await api.delete(`/api/auth/tokens/${pat.id}`);
        expect([200, 204]).toContain(delRes.status);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F07] POST /api/auth/pairing-qr generates Desktop QR pairing payload with primary_url, fallback_url, and live-verifiable PAT',
    { tag: ['@tier1', '@F07'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const qrRes = await api.post('/api/auth/pairing-qr', {
          primary_url: 'http://192.168.1.42:8080',
          fallback_url: 'https://life.vitorx86.dev',
          token_name: 'QR Paired Phone',
        });
        expect([200, 201]).toContain(qrRes.status);

        const tokenId = qrRes.json.token_id ?? qrRes.json.id;
        if (tokenId) {
          cleanup.defer(() => api.delete(`/api/auth/tokens/${tokenId}`));
        }

        expect(qrRes.json.primary_url).toBe('http://192.168.1.42:8080');
        expect(qrRes.json.fallback_url).toBe('https://life.vitorx86.dev');
        expect(String(qrRes.json.token)).toMatch(/^plm_pat_[0-9a-f]{32,}$/i);

        if (typeof qrRes.json.qr_payload_json === 'string') {
          const parsedQr = JSON.parse(qrRes.json.qr_payload_json);
          expect(parsedQr.primary_url).toBe('http://192.168.1.42:8080');
          expect(parsedQr.token).toBe(qrRes.json.token);
        }

        const verifyRes = await api
          .withToken(String(qrRes.json.token))
          .get('/api/auth/verify');
        expect(verifyRes.status).toBe(200);
        expect(verifyRes.json.authenticated).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );
});
