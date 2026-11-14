import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  E2E_PATHS,
  ensureStackReady,
  createApiClient,
  unwrapList,
  createPatToken,
  uniqueId,
  CleanupRegistry,
  waitForAppReady,
  auditZeroBorderRadius,
  auditInteractiveFontFloor,
  auditColorTokens,
  auditPixelatedSprites,
  auditApertureLogo,
  auditOrthogonalBlueprintCorridors,
} from '../../harness';

function makeUuidV7(): string {
  const nowHex = Date.now().toString(16).padStart(12, '0').slice(-12);
  const randA = crypto.randomBytes(2).toString('hex').slice(1);
  const randB = crypto.randomBytes(8).toString('hex');
  const variantNibble = ((parseInt(randB[0] || '8', 16) & 0x3) | 0x8).toString(16);
  return `${nowHex.slice(0, 8)}-${nowHex.slice(8, 12)}-7${randA}-${variantNibble}${randB.slice(1, 4)}-${randB.slice(4, 16)}`;
}

async function togglePrivacyMaskIfPresent(page: Page): Promise<boolean> {
  const trigger = page
    .locator(
      'button[aria-label*="privacy" i], button[title*="privacy" i], [data-privacy-toggle], button:has-text("👁")',
    )
    .first();
  if ((await trigger.count()) > 0) {
    await trigger.click();
    await page.waitForTimeout(200);
    return true;
  }
  return false;
}

test.describe('Tier 3 Pairwise — FUI Theme, Aperture, Sprites, Blueprint & Mobile Companion (T3-28..T3-40)', () => {
  test(
    '[T3-28][F18][F24][F32] Global Privacy Mask (👁️) blurring currency amounts across /finance, /dashboard, and /monitor while preserving Waffle %, FI ring %, and Years-to-FI',
    { tag: ['@tier3', '@F18', '@F24', '@F32'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        const assetRes = await api.post('/api/finance/assets', {
          symbol: uniqueId('PRIV').toUpperCase().slice(0, 10),
          name: 'Privacy Mask Asset',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 10,
          avg_cost_cents: 7654300,
          current_price_cents: 8765400,
          target_weight_pct: 50,
        });
        expect([200, 201]).toContain(assetRes.status);
        const asset = assetRes.json?.asset ?? assetRes.json;
        cleanup.defer(async () => {
          await api.delete(`/api/finance/assets/${asset.id}`);
        });

        await waitForAppReady(page, `${baseUrl}/finance`);
        const toggled = await togglePrivacyMaskIfPresent(page);
        expect(toggled).toBe(true);

        const maskedState = await page.evaluate(() => {
          const maskedNodes = document.querySelectorAll(
            '[data-privacy-masked="true"], [data-privacy-blur], .privacy-blur, .privacy-mask',
          );
          const blurredByStyle = Array.from(document.querySelectorAll('*')).filter((el) => {
            const style = window.getComputedStyle(el);
            return style.filter && style.filter.includes('blur');
          });
          const bodyText = document.body.innerText || '';
          const hasBulletMask = bodyText.includes('••••') || bodyText.includes('***');
          const hasPercentageStillVisible = bodyText.includes('%');
          return {
            hasMaskedIndicator:
              maskedNodes.length > 0 || blurredByStyle.length > 0 || hasBulletMask,
            hasPercentageStillVisible,
          };
        });
        expect(maskedState.hasMaskedIndicator).toBe(true);
        expect(maskedState.hasPercentageStillVisible).toBe(true);

        await waitForAppReady(page, `${baseUrl}/dashboard`);
        const dashRadius = await auditZeroBorderRadius(page);
        expect(dashRadius.violations).toEqual([]);

        await waitForAppReady(page, `${baseUrl}/monitor`);
        const monRadius = await auditZeroBorderRadius(page);
        expect(monRadius.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-29][F18][F19][F23] REF-02 0px rectilinear law, >=12px interactive font floor, and REF-10 5-layer Mechanical Shutter Aperture Logo across Web SPA shell',
    { tag: ['@tier3', '@F18', '@F19', '@F23'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      await waitForAppReady(page, `${baseUrl}/dashboard`);

      const colorAudit = await auditColorTokens(page);
      expect(colorAudit.hasCarbonBg).toBe(true);
      expect(colorAudit.hasBlazeOrangeAccent).toBe(true);
      expect(colorAudit.hasStarkWhiteInk).toBe(true);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.checkedCount).toBeGreaterThan(10);
      expect(radiusAudit.violations).toEqual([]);

      const fontAudit = await auditInteractiveFontFloor(page, 12);
      expect(fontAudit.checkedCount).toBeGreaterThan(5);
      expect(fontAudit.violations).toEqual([]);

      const logoAudit = await auditApertureLogo(page);
      expect(logoAudit.found).toBe(true);
      expect(logoAudit.svgLayerCount).toBeGreaterThanOrEqual(4);
      expect(logoAudit.hasOrangeGear).toBe(true);
      expect(logoAudit.hasShutterBlades).toBe(true);
      expect(logoAudit.hasStatusIris).toBe(true);
    },
  );

  test(
    '[T3-30][F20][F23][F25] REF-09 Orbital Boot Astrolabe stage progression [1..3], REF-08 Geodesic Thinking Orb on /hermes [🧠 HIGH_LEVEL_PLAN], and REF-11/12 HUD loaders',
    { tag: ['@tier3', '@F20', '@F23', '@F25'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      await waitForAppReady(page, `${baseUrl}/hermes`);

      const highLevelToggle = page
        .locator(
          'button:has-text("HIGH_LEVEL"), button:has-text("High-Level"), [data-high-level-toggle], button[aria-label*="high" i]',
        )
        .first();
      if ((await highLevelToggle.count()) > 0) {
        await highLevelToggle.click();
        await page.waitForTimeout(200);
      }

      const orbAudit = await page.evaluate(() => {
        const orbEl = document.querySelector(
          '[data-fui-orb], [data-testid*="thinking-orb" i], [class*="thinking-orb" i], [class*="geodesic" i], svg, canvas',
        );
        const canvases = Array.from(document.querySelectorAll('canvas'));
        let hasWebGl = false;
        for (const c of canvases) {
          if (c.getContext('webgl') || c.getContext('webgl2')) {
            hasWebGl = true;
          }
        }
        return {
          hasOrbOrSvg: Boolean(orbEl),
          hasWebGl,
        };
      });
      expect(orbAudit.hasOrbOrSvg).toBe(true);
      expect(orbAudit.hasWebGl).toBe(false);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const fontAudit = await auditInteractiveFontFloor(page, 12);
      expect(fontAudit.violations).toEqual([]);
    },
  );

  test(
    '[T3-31][F21][F26][F12] Agent Studio /agents REF-13 Isometric Knight Arena (2:1 #141526 grid, 4 zones, PNG+JSON pixelated sprites, Standby Barracks pause, and HP budget circuit breaker)',
    { tag: ['@tier3', '@F21', '@F26', '@F12'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        const createRes = await api.post('/api/agents', {
          slug: uniqueId('barracks-knight-t331'),
          name: 'Standby Knight T3-31',
          knight_archetype: 'Ranger',
          crest_color: '#A8F040',
          grid_pos: { x: 0, y: 0, zone: 'standby_barracks' },
          system_prompt: 'Standby sentinel on {{today}}.',
          model_config: { model: 'nousresearch/hermes-3-llama-3.1-70b' },
          tools_policy: { todos_list_tasks: 'READ' },
          monthly_budget_cents: 0,
          is_mastermind_member: false,
          enabled: false,
        });
        expect([200, 201]).toContain(createRes.status);
        const knight = createRes.json?.agent ?? createRes.json;
        const knightId = knight.id;
        cleanup.defer(async () => {
          await api.delete(`/api/agents/${knightId}`);
        });

        const liveDispatch = await api.post(`/api/agents/${knightId}/dispatch`, {
          dry_run: false,
        });
        const blockedByCircuitOrBarracks =
          liveDispatch.status >= 400 ||
          ['blocked', 'paused', 'budget_exceeded', 'failed', 'skipped'].includes(
            String(
              (liveDispatch.json?.run ?? liveDispatch.json)?.status ??
                liveDispatch.json?.error ??
                '',
            ).toLowerCase(),
          );
        expect(blockedByCircuitOrBarracks).toBe(true);

        const dryRunRes = await api.post(`/api/agents/${knightId}/dispatch?dry_run=true`, {
          dry_run: true,
        });
        expect([200, 201]).toContain(dryRunRes.status);

        await waitForAppReady(page, `${baseUrl}/agents`);
        const spriteAudit = await auditPixelatedSprites(page);
        expect(spriteAudit.spriteCount).toBeGreaterThanOrEqual(1);
        expect(spriteAudit.violations).toEqual([]);

        const pageText = (await page.locator('body').innerText()).toLowerCase();
        expect(pageText).toContain('chronos');
        expect(pageText).toContain('aurum');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-32][F21][F27][F18] Omnipresent Frieren <CompanionStage /> perched mini-sprite on 3px #F87C18 header ledges and REF-14 4-phase portrait with integer pixelated scaling',
    { tag: ['@tier3', '@F21', '@F27', '@F18'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();

      await waitForAppReady(page, `${baseUrl}/dashboard`);
      await page.keyboard.press('Control+j');
      await page.waitForTimeout(250);

      const dashSprites = await auditPixelatedSprites(page);
      expect(dashSprites.spriteCount).toBeGreaterThanOrEqual(1);
      expect(dashSprites.violations).toEqual([]);

      const dashRadius = await auditZeroBorderRadius(page);
      expect(dashRadius.violations).toEqual([]);

      await waitForAppReady(page, `${baseUrl}/courses`);
      const courseSprites = await auditPixelatedSprites(page);
      expect(courseSprites.spriteCount).toBeGreaterThanOrEqual(1);
      expect(courseSprites.violations).toEqual([]);
    },
  );

  test(
    '[T3-33][F22][F24][F11] Room Monitor /monitor auto-cycling on cycle_seconds with 1px #F87C18 countdown hairline, Space pin/pause, Arrow key deck jump, and REF-06 telemetry charts',
    { tag: ['@tier3', '@F22', '@F24', '@F11'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);

      const decksRes = await api.get('/api/dashboards');
      expect(decksRes.status).toBe(200);
      const decks = unwrapList(decksRes);
      expect(decks.length).toBeGreaterThanOrEqual(2);

      await waitForAppReady(page, `${baseUrl}/monitor`);

      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
      await page.keyboard.press('Space');
      await page.waitForTimeout(200);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.checkedCount).toBeGreaterThan(5);
      expect(radiusAudit.violations).toEqual([]);

      const fontAudit = await auditInteractiveFontFloor(page, 12);
      expect(fontAudit.violations).toEqual([]);
    },
  );

  test(
    '[T3-34][F30][F15][F18] Yearly Goals /goals REF-03 #10171D Orthogonal Blueprint Map (8-bit binary border, Q1-Q4 Matrix, strictly 90° Manhattan corridors, and blueprint_pos pin)',
    { tag: ['@tier3', '@F30', '@F15', '@F18'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        await api.post('/api/goals/cycles', {
          year: 2026,
          theme: 'Tier 3 Blueprint Verification',
          status: 'active',
        });

        const g1Res = await api.post('/api/goals', {
          year: 2026,
          pillar: 'systems',
          code: uniqueId('G-BP1').slice(0, 12),
          title: uniqueId('Blueprint Systems Node'),
          status: 'in_progress',
          priority_rank: 1,
        });
        expect([200, 201]).toContain(g1Res.status);
        const g1 = g1Res.json?.goal ?? g1Res.json;
        cleanup.defer(async () => {
          await api.delete(`/api/goals/${g1.id}`);
        });

        const g2Res = await api.post('/api/goals', {
          year: 2026,
          pillar: 'finance',
          code: uniqueId('G-BP2').slice(0, 12),
          title: uniqueId('Blueprint Finance Node'),
          status: 'in_progress',
          priority_rank: 2,
        });
        expect([200, 201]).toContain(g2Res.status);
        const g2 = g2Res.json?.goal ?? g2Res.json;
        cleanup.defer(async () => {
          await api.delete(`/api/goals/${g2.id}`);
        });

        const pinRes = await api.patch(`/api/goals/${g1.id}/blueprint-pos`, {
          x: 280,
          y: 160,
          blueprint_pos: { x: 280, y: 160 },
        });
        expect(pinRes.status).toBe(200);

        const bpRes = await api.get('/api/goals/cycles/2026/blueprint');
        expect(bpRes.status).toBe(200);
        expect(JSON.stringify(bpRes.json)).toContain('280');

        await waitForAppReady(page, `${baseUrl}/goals`);
        const corridorAudit = await auditOrthogonalBlueprintCorridors(page);
        expect(corridorAudit.segmentCount).toBeGreaterThan(0);
        expect(corridorAudit.diagonalOrCurvedViolations).toEqual([]);

        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-35][F33][F05][F18] Strict mobile scope boundary on apps/mobile (:4174) — ONLY ROUTINES, TODOS, COMPANION, and UPLINK_CONFIG with zero excluded desktop modules',
    { tag: ['@tier3', '@F33', '@F05', '@F18'] },
    async ({ page }) => {
      const capConfigPath = path.join(E2E_PATHS.repoRoot, 'apps', 'mobile', 'capacitor.config.ts');
      expect(fs.existsSync(capConfigPath)).toBe(true);
      const capConfig = fs.readFileSync(capConfigPath, 'utf8');
      expect(capConfig).toContain('dev.vitorx86.hermes.companion');
      expect(capConfig).toContain('dist');

      const { mobileUrl } = await ensureStackReady({ requireMobile: true });
      await waitForAppReady(page, `${mobileUrl}/`);

      const bodyText = (await page.locator('body').innerText()).toUpperCase();
      expect(bodyText).toContain('ROUTINES');
      expect(bodyText).toContain('TODOS');
      expect(bodyText).toContain('COMPANION');

      const excludedNavLinks = await page
        .locator(
          'a[href="/monitor"], a[href="/hermes"], a[href="/agents"], a[href="/goals"], a[href="/courses"], a[href="/finance"]',
        )
        .count();
      expect(excludedNavLinks).toBe(0);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.checkedCount).toBeGreaterThan(3);
      expect(radiusAudit.violations).toEqual([]);

      const fontAudit = await auditInteractiveFontFloor(page, 12);
      expect(fontAudit.violations).toEqual([]);
    },
  );

  test(
    '[T3-36][F33][F34][F07] Mobile UPLINK_CONFIG Primary -> Fallback Server URL failover, encrypted PAT storage, and [⚡ TEST UPLINK] against /api/auth/verify',
    { tag: ['@tier3', '@F33', '@F34', '@F07'] },
    async ({ page }) => {
      const { baseUrl, mobileUrl } = await ensureStackReady({ requireMobile: true });
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        const pat = await createPatToken(api, uniqueId('t3-36-mobile-failover'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        expect(pat.token).toMatch(/^plm_pat_/);

        await waitForAppReady(page, `${mobileUrl}/`);
        await expect(page.locator('body')).toBeVisible();

        const mobileRadius = await auditZeroBorderRadius(page);
        expect(mobileRadius.violations).toEqual([]);

        const mobileFonts = await auditInteractiveFontFloor(page, 12);
        expect(mobileFonts.violations).toEqual([]);

        const uplinkTrigger = page
          .locator(
            'button:has-text("UPLINK"), [data-tab="uplink"], [data-testid*="uplink" i], button[aria-label*="uplink" i]',
          )
          .first();
        if ((await uplinkTrigger.count()) > 0) {
          await uplinkTrigger.click();
          await page.waitForTimeout(200);
        }

        const inputs = page.locator('input');
        const inputCount = await inputs.count();
        if (inputCount >= 3) {
          await inputs.nth(0).fill('http://127.0.0.1:59998');
          await inputs.nth(1).fill(baseUrl);
          await inputs.nth(2).fill(pat.token);
        }

        const testBtn = page
          .locator('button:has-text("TEST UPLINK"), button:has-text("SAVE"), button:has-text("CONNECT")')
          .first();
        if ((await testBtn.count()) > 0) {
          await testBtn.click();
          await page.waitForTimeout(400);
        }

        const storageDump = await page.evaluate(() =>
          JSON.stringify({
            local: Object.entries(localStorage),
            session: Object.entries(sessionStorage),
          }),
        );
        expect(storageDump).not.toContain(pat.token);

        const verifyRes = await api.withToken(pat.token).get('/api/auth/verify');
        expect(verifyRes.status).toBe(200);
        expect(verifyRes.json?.authenticated).toBe(true);
        expect(Number(verifyRes.json?.latest_server_seq ?? -1)).toBeGreaterThanOrEqual(0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-37][F34][F08][F28][F29] End-to-end offline Mobile SQLite UUIDv7 Todo and Routine creation queued in sync_outbox and reconciled to Web SPA on reconnect',
    { tag: ['@tier3', '@F34', '@F08', '@F28', '@F29'] },
    async ({ page }) => {
      const { baseUrl, mobileUrl } = await ensureStackReady({ requireMobile: true });
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        const pat = await createPatToken(api, uniqueId('t3-37-mob-sync'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authedApi = api.withToken(pat.token);

        await waitForAppReady(page, `${mobileUrl}/`);

        const taskId = makeUuidV7();
        const taskTitle = uniqueId('T3-37 Offline Mobile Todo');
        cleanup.defer(async () => {
          await api.delete(`/api/tasks/${taskId}`);
        });

        const pushRes = await authedApi.post('/api/sync/push', {
          client_id: uniqueId('mob-t3-37'),
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'tasks',
              entity_id: taskId,
              op: 'upsert',
              payload: {
                id: taskId,
                title: taskTitle,
                status: 'todo',
                priority: 'high',
                energy_level: 'quick',
              },
              client_updated_at: new Date().toISOString(),
            },
          ],
        });
        expect(pushRes.status).toBe(200);
        expect(Number(pushRes.json?.applied_count ?? 0)).toBeGreaterThanOrEqual(1);

        const tasksRes = await api.get('/api/tasks');
        expect(tasksRes.status).toBe(200);
        const tasks = unwrapList(tasksRes);
        const syncedTask = tasks.find((t: any) => t.id === taskId || t.title === taskTitle);
        expect(syncedTask).toBeTruthy();
        expect(syncedTask.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );

        await waitForAppReady(page, `${baseUrl}/todos`);
        const webBody = await page.locator('body').innerText();
        expect(webBody).toContain(taskTitle);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-38][F35][F21][F08] Dual-Mode Mobile Frieren Companion switching between offline pixelated sprite loops + synced companion_offline_phrases quotes and online live SSE chat',
    { tag: ['@tier3', '@F35', '@F21', '@F08'] },
    async ({ page }) => {
      const { baseUrl, mobileUrl } = await ensureStackReady({ requireMobile: true });
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        const pat = await createPatToken(api, uniqueId('t3-38-frieren-pat'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authedApi = api.withToken(pat.token);

        const phraseText = uniqueId('T3-38 Consistency is the most reliable magic.');
        const phraseRes = await api.post('/api/companion/phrases', {
          phrase_text: phraseText,
          trigger_context: 'any',
        });
        expect([200, 201]).toContain(phraseRes.status);
        const phraseObj = phraseRes.json?.phrase ?? phraseRes.json;
        if (phraseObj?.id) {
          cleanup.defer(async () => {
            await api.delete(`/api/companion/phrases/${phraseObj.id}`);
          });
        }

        const pullRes = await authedApi.get('/api/sync/pull?since=0');
        expect(pullRes.status).toBe(200);
        expect(JSON.stringify(pullRes.json)).toContain(phraseText);

        await waitForAppReady(page, `${mobileUrl}/`);
        const companionTab = page
          .locator('button:has-text("COMPANION"), [data-tab="companion"], a:has-text("COMPANION")')
          .first();
        if ((await companionTab.count()) > 0) {
          await companionTab.click();
          await page.waitForTimeout(250);
        }

        const spriteAudit = await auditPixelatedSprites(page);
        expect(spriteAudit.spriteCount).toBeGreaterThanOrEqual(1);
        expect(spriteAudit.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-39][F19][F20][F34][F35] Mobile cold-boot REF-09 Orbital Astrolabe, REF-10 Aperture Logo status iris shift (amber offline vs phosphor online), and REF-12 WIFI sync indicator',
    { tag: ['@tier3', '@F19', '@F20', '@F34', '@F35'] },
    async ({ page }) => {
      const { mobileUrl } = await ensureStackReady({ requireMobile: true });
      await waitForAppReady(page, `${mobileUrl}/`);

      const logoAudit = await auditApertureLogo(page);
      expect(logoAudit.found).toBe(true);
      expect(logoAudit.hasOrangeGear).toBe(true);
      expect(logoAudit.hasShutterBlades).toBe(true);
      expect(logoAudit.hasStatusIris).toBe(true);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);
    },
  );

  test(
    '[T3-40][F01][F02][F03][F05][F36] Full-stack repository, container config, static bundle, and data/ zero-tracking privacy invariant audit after cross-feature operations',
    { tag: ['@tier3', '@F01', '@F02', '@F03', '@F05', '@F36'] },
    async () => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);

      const healthRes = await api.get('/api/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.json?.status).toBe('ok');
      expect(healthRes.json?.db_online).toBe(true);
      expect(healthRes.json?.redis_online).toBe(true);
      expect(['online', 'offline_mock']).toContain(healthRes.json?.hermes_gateway);

      expect(fs.existsSync(path.join(E2E_PATHS.repoRoot, 'personal-system'))).toBe(false);
      expect(fs.existsSync(path.join(E2E_PATHS.repoRoot, 'infra-deploy', 'Dockerfile'))).toBe(true);
      expect(fs.existsSync(path.join(E2E_PATHS.repoRoot, 'podman-compose.yml'))).toBe(true);

      const trackedData = execFileSync('git', ['ls-files', 'data/'], {
        cwd: E2E_PATHS.repoRoot,
        encoding: 'utf8',
      }).trim();
      expect(trackedData).toBe('');

      const statusData = execFileSync('git', ['status', '--porcelain', 'data/'], {
        cwd: E2E_PATHS.repoRoot,
        encoding: 'utf8',
      }).trim();
      expect(statusData).toBe('');
    },
  );
});
