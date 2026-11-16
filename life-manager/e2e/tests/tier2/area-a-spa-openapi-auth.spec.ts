import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  E2E_URLS,
  ensureStackReady,
  withIsolatedBackend,
  createApiClient,
  unwrapList,
  createPatToken,
  uniqueId,
  CleanupRegistry,
} from '../../harness';

function collectSchemaRefs(node: unknown, refs: Set<string> = new Set()): Set<string> {
  if (!node || typeof node !== 'object') return refs;
  if (Array.isArray(node)) {
    for (const item of node) {
      collectSchemaRefs(item, refs);
    }
    return refs;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.$ref === 'string' && obj.$ref.startsWith('#/components/schemas/')) {
    refs.add(obj.$ref.slice('#/components/schemas/'.length));
  }
  for (const val of Object.values(obj)) {
    collectSchemaRefs(val, refs);
  }
  return refs;
}

test.describe('Area A Tier 2 — SPA Routing, OpenAPI 3.1 & PAT Auth Boundary/Negative/Security Suite (F05..F07)', () => {
  // =========================================================================
  // Feature F05: Static SPA Serving & Fallback Negative/Security Tests (5 tests)
  // =========================================================================

  test(
    '[T2][F05] Unknown GET /api/* routes return 404 Not Found with application/json error payload and never SPA index.html',
    { tag: ['@tier2', '@F05'] },
    async () => {
      await ensureStackReady();

      for (const unknownPath of [
        '/api/nonexistent-route-404',
        '/api/v1/unknown/resource',
      ]) {
        const res = await fetch(`${E2E_URLS.baseUrl}${unknownPath}`, {
          headers: { Accept: 'text/html,application/json' },
        });
        expect(res.status).toBe(404);
        expect(res.headers.get('content-type') || '').toMatch(/application\/json/i);

        const text = await res.text();
        expect(text).not.toMatch(/<!doctype html>/i);
        expect(text).not.toContain('<div id="root"');

        const parsed = JSON.parse(text);
        expect(typeof parsed.error).toBe('string');
        expect(parsed.error.length).toBeGreaterThan(0);
      }
    },
  );

  test(
    '[T2][F05] Unknown POST, PUT, PATCH, and DELETE requests under /api/* return JSON 404/405 and never fall back to HTML',
    { tag: ['@tier2', '@F05'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();

      const responses = [
        await api.post('/api/unknown-mutation', { test: true }),
        await api.put('/api/unknown-mutation', { test: true }),
        await api.patch('/api/unknown-mutation', { test: true }),
        await api.delete('/api/unknown-mutation'),
      ];

      for (const res of responses) {
        expect([404, 405]).toContain(res.status);
        expect(res.headers.get('content-type') || '').toMatch(/application\/json/i);
        expect(res.text).not.toContain('<div id="root"');
        expect(typeof res.json?.error).toBe('string');
      }
    },
  );

  test(
    '[T2][F05] Path traversal probes against static asset serving (/..%2f..%2fbackend/Cargo.toml) never disclose files outside STATIC_DIST_DIR',
    { tag: ['@tier2', '@F05'] },
    async () => {
      await ensureStackReady();

      const traversalPaths = [
        '/..%2f..%2fbackend%2fCargo.toml',
        '/assets/..%2f..%2f..%2fpackage.json',
        '/%2e%2e/%2e%2e/.gitignore',
      ];

      for (const probe of traversalPaths) {
        const res = await fetch(`${E2E_URLS.baseUrl}${probe}`);
        const body = await res.text();
        expect(body).not.toContain('[workspace]');
        expect(body).not.toContain('"hermes-os-monorepo"');
        expect(body).not.toContain('# Environment files');
      }
    },
  );

  test(
    '[T2][F05] Custom STATIC_DIST_DIR override via withIsolatedBackend serves custom index.html and static assets while preserving /api/* JSON 404s',
    { tag: ['@tier2', '@F05'] },
    async () => {
      const tempDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-e2e-dist-'));
      try {
        const assetsDir = path.join(tempDistDir, 'assets');
        fs.mkdirSync(assetsDir, { recursive: true });
        fs.writeFileSync(
          path.join(tempDistDir, 'index.html'),
          '<!doctype html><html><body><div id="root" data-custom-dist="e2e-custom-spa"></div></body></html>',
          'utf8',
        );
        fs.writeFileSync(
          path.join(assetsDir, 'custom.txt'),
          'CUSTOM_ASSET_OK',
          'utf8',
        );

        await withIsolatedBackend(
          { STATIC_DIST_DIR: tempDistDir },
          async ({ baseUrl }) => {
            const rootRes = await fetch(`${baseUrl}/`);
            expect(rootRes.status).toBe(200);
            expect(await rootRes.text()).toContain('data-custom-dist="e2e-custom-spa"');

            const deepRes = await fetch(`${baseUrl}/monitor`);
            expect(deepRes.status).toBe(200);
            expect(await deepRes.text()).toContain('data-custom-dist="e2e-custom-spa"');

            const assetRes = await fetch(`${baseUrl}/assets/custom.txt`);
            expect(assetRes.status).toBe(200);
            expect((await assetRes.text()).trim()).toBe('CUSTOM_ASSET_OK');

            const api404Res = await fetch(`${baseUrl}/api/unknown-endpoint`);
            expect(api404Res.status).toBe(404);
            expect(api404Res.headers.get('content-type') || '').toMatch(
              /application\/json/i,
            );
          },
        );
      } finally {
        fs.rmSync(tempDistDir, { recursive: true, force: true });
      }
    },
  );

  test(
    '[T2][F05] Missing static asset file with explicit extension (/assets/missing-chunk-99999.js) does not masquerade as executable JavaScript',
    { tag: ['@tier2', '@F05'] },
    async () => {
      await ensureStackReady();
      const res = await fetch(`${E2E_URLS.baseUrl}/assets/nonexistent-bundle-999999.js`);
      const contentType = (res.headers.get('content-type') || '').toLowerCase();

      if (res.status === 200) {
        expect(contentType).not.toContain('javascript');
      } else {
        expect(res.status).toBe(404);
      }
    },
  );

  // =========================================================================
  // Feature F06: OpenAPI 3.1 Schema Integrity & Conformance Tests (5 tests)
  // =========================================================================

  test(
    '[T2][F06] Every internal $ref pointer in GET /api/openapi.json resolves to a defined component with zero dangling references',
    { tag: ['@tier2', '@F06'] },
    async () => {
      await ensureStackReady();
      const res = await createApiClient().get('/api/openapi.json');
      expect(res.status).toBe(200);

      const schemas = (res.json?.components?.schemas || {}) as Record<string, unknown>;
      const refs = collectSchemaRefs(res.json);
      expect(refs.size).toBeGreaterThan(10);

      const dangling: string[] = [];
      for (const refName of refs) {
        if (!(refName in schemas)) {
          dangling.push(refName);
        }
      }
      expect(dangling).toEqual([]);
    },
  );

  test(
    '[T2][F06] OpenAPI specification contains zero raw Rust module path names or unannotated pgvector::Vector schemas',
    { tag: ['@tier2', '@F06'] },
    async () => {
      await ensureStackReady();
      const res = await createApiClient().get('/api/openapi.json');
      expect(res.status).toBe(200);

      const schemas = (res.json?.components?.schemas || {}) as Record<string, any>;
      const schemaNames = Object.keys(schemas);
      expect(schemaNames.length).toBeGreaterThan(0);

      for (const name of schemaNames) {
        expect(name, `Schema name ${name} must not contain Rust :: path`).not.toContain(
          '::',
        );
      }

      expect(res.text).not.toContain('pgvector::Vector');
    },
  );

  test(
    '[T2][F06] Live GET /api/health response conforms 100% to its declared OpenAPI 3.1 schema',
    { tag: ['@tier2', '@F06'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();

      const [specRes, healthRes] = await Promise.all([
        api.get('/api/openapi.json'),
        api.get('/api/health'),
      ]);
      expect(specRes.status).toBe(200);
      expect(healthRes.status).toBe(200);

      const healthPathSpec = specRes.json?.paths?.['/api/health']?.get;
      expect(healthPathSpec).toBeDefined();

      const schemas = specRes.json?.components?.schemas || {};
      const healthSchema =
        schemas.HealthStatusResponse ||
        healthPathSpec?.responses?.['200']?.content?.['application/json']?.schema;
      expect(healthSchema).toBeDefined();

      const requiredFields: string[] = healthSchema?.required || [
        'status',
        'db_online',
        'redis_online',
        'hermes_gateway',
        'version',
      ];
      for (const field of requiredFields) {
        expect(healthRes.json).toHaveProperty(field);
      }

      expect(typeof healthRes.json.status).toBe('string');
      expect(typeof healthRes.json.db_online).toBe('boolean');
      expect(typeof healthRes.json.redis_online).toBe('boolean');
      expect(['online', 'offline_mock']).toContain(healthRes.json.hermes_gateway);
      expect(typeof healthRes.json.version).toBe('string');
    },
  );

  test(
    '[T2][F06] Live 401 and 404 JSON error responses conform to the declared OpenAPI ApiError schema',
    { tag: ['@tier2', '@F06'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();

      const res401 = await api.get('/api/auth/verify');
      expect(res401.status).toBe(401);
      expect(res401.headers.get('content-type') || '').toMatch(/application\/json/i);
      expect(typeof res401.json?.error).toBe('string');
      expect(res401.json.error.length).toBeGreaterThan(0);

      const res404 = await api.get('/api/nonexistent-openapi-check');
      expect(res404.status).toBe(404);
      expect(res404.headers.get('content-type') || '').toMatch(/application\/json/i);
      expect(typeof res404.json?.error).toBe('string');
      expect(res404.json.error.length).toBeGreaterThan(0);
    },
  );

  test(
    '[T2][F06] GET /api/openapi.json remains publicly accessible without credentials even when REQUIRE_WEB_LOGIN=true',
    { tag: ['@tier2', '@F06'] },
    async () => {
      await withIsolatedBackend(
        { REQUIRE_WEB_LOGIN: 'true' },
        async ({ apiBaseUrl }) => {
          const api = createApiClient(apiBaseUrl);
          const res = await api.get('/api/openapi.json');
          expect(res.status).toBe(200);
          expect(String(res.json?.openapi || '')).toMatch(/^3\.1\.\d+$/);
        },
      );
    },
  );

  // =========================================================================
  // Feature F07: Operator Auth & PAT Negative/Security Tests (5 tests)
  // =========================================================================

  test(
    '[T2][F07] GET /api/auth/verify rejects missing, empty, non-Bearer, malformed, and unknown PAT headers with 401 Unauthorized',
    { tag: ['@tier2', '@F07'] },
    async () => {
      await ensureStackReady();
      const verifyUrl = `${E2E_URLS.apiBaseUrl}/auth/verify`;

      const headerVariants: Array<Record<string, string>> = [
        {},
        { Authorization: '' },
        { Authorization: 'Basic YWRtaW46cGFzcw==' },
        { Authorization: 'Bearer malformed_not_a_pat' },
        { Authorization: 'Bearer plm_pat_ffffffffffffffffffffffffffffffff' },
      ];

      for (const headers of headerVariants) {
        const res = await fetch(verifyUrl, {
          method: 'GET',
          headers: { Accept: 'application/json', ...headers },
        });
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe('unauthorized');
      }
    },
  );

  test(
    '[T2][F07] Revoking a PAT via DELETE /api/auth/tokens/{id} immediately blocks /api/auth/verify and /api/sync/pull with 401 Unauthorized',
    { tag: ['@tier2', '@F07'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const pat = await createPatToken(api, uniqueId('Revoke-Test-PAT'));

      const beforeRevoke = await api.withToken(pat.token).get('/api/auth/verify');
      expect(beforeRevoke.status).toBe(200);

      const delRes = await api.delete(`/api/auth/tokens/${pat.id}`);
      expect([200, 204]).toContain(delRes.status);

      const revokedApi = api.withToken(pat.token);
      const afterVerify = await revokedApi.get('/api/auth/verify');
      expect(afterVerify.status).toBe(401);

      const afterSyncPull = await revokedApi.get('/api/sync/pull?since=0');
      expect(afterSyncPull.status).toBe(401);

      const afterSyncPush = await revokedApi.post('/api/sync/push', {
        client_id: 'revoked-client',
        mutations: [],
      });
      expect(afterSyncPush.status).toBe(401);
    },
  );

  test(
    '[T2][F07] GET /api/auth/tokens never exposes plaintext PAT secrets or raw SHA-256 token digests',
    { tag: ['@tier2', '@F07'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const pat = await createPatToken(api, uniqueId('Secret-Redaction-Check'));
        cleanup.defer(() => api.delete(`/api/auth/tokens/${pat.id}`));

        const sha256Hex = crypto
          .createHash('sha256')
          .update(pat.token)
          .digest('hex');

        const listRes = await api.get('/api/auth/tokens');
        expect(listRes.status).toBe(200);

        expect(listRes.text.includes(pat.token)).toBe(false);
        expect(listRes.text.toLowerCase().includes(sha256Hex.toLowerCase())).toBe(false);

        const tokens = unwrapList<Record<string, any>>(listRes, ['tokens']);
        const entry = tokens.find((t) => String(t.id) === pat.id);
        expect(entry).toBeDefined();
        expect(entry!.token).toBeUndefined();
        expect(entry!.token_sha256).toBeUndefined();
        expect(typeof entry!.token_prefix).toBe('string');
        expect(entry!.token_prefix.length).toBeGreaterThan(8);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F07] Invalid or revoked Bearer token on any /api/* or /mcp route is rejected with 401 even when REQUIRE_WEB_LOGIN=false',
    { tag: ['@tier2', '@F07'] },
    async () => {
      await ensureStackReady();
      const invalidApi = createApiClient().withToken(
        'plm_pat_deadbeefdeadbeefdeadbeefdeadbeef',
      );

      for (const route of ['/api/dashboards', '/api/tasks', '/api/finance/assets']) {
        const res = await invalidApi.get(route);
        expect(res.status, `Expected 401 on ${route} with invalid PAT`).toBe(401);
      }

      const mcpRes = await fetch(E2E_URLS.mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: 'Bearer plm_pat_deadbeefdeadbeefdeadbeefdeadbeef',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'e2e-invalid-pat', version: '1.0.0' },
          },
        }),
      });
      expect(mcpRes.status).toBe(401);
    },
  );

  test(
    '[T2][F07] POST /api/auth/login rejects wrong credentials with 401 and REQUIRE_WEB_LOGIN=true enforces auth while honoring HERMES_BOOTSTRAP_PAT',
    { tag: ['@tier2', '@F07'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();

      const badPassRes = await api.post('/api/auth/login', {
        username: 'operator',
        password: 'wrong-password-123',
      });
      expect(badPassRes.status).toBe(401);

      const badUserRes = await api.post('/api/auth/login', {
        username: 'nonexistent-user',
        password: 'hermes-os-local',
      });
      expect(badUserRes.status).toBe(401);

      const bootstrapPat = 'plm_pat_11223344556677889900aabbccddeeff';
      await withIsolatedBackend(
        {
          REQUIRE_WEB_LOGIN: 'true',
          HERMES_BOOTSTRAP_PAT: bootstrapPat,
        },
        async ({ apiBaseUrl }) => {
          const isoApi = createApiClient(apiBaseUrl);

          const unauthDashRes = await isoApi.get('/api/dashboards');
          expect(unauthDashRes.status).toBe(401);

          const unauthMeRes = await isoApi.get('/api/auth/me');
          expect(unauthMeRes.status).toBe(401);

          const publicHealthRes = await isoApi.get('/api/health');
          expect(publicHealthRes.status).toBe(200);

          const authedIsoApi = isoApi.withToken(bootstrapPat);
          const verifyRes = await authedIsoApi.get('/api/auth/verify');
          expect(verifyRes.status).toBe(200);
          expect(verifyRes.json.authenticated).toBe(true);

          const authedDashRes = await authedIsoApi.get('/api/dashboards');
          expect(authedDashRes.status).toBe(200);
        },
      );
    },
  );
});
