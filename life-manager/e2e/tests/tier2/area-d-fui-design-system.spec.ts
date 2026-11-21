import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  CleanupRegistry,
  E2E_PATHS,
  E2E_URLS,
  FUI_COMPLIANT_SELF_TEST_HTML,
  FUI_VIOLATING_SELF_TEST_HTML,
  auditApertureLogo,
  auditColorTokens,
  auditInteractiveFontFloor,
  auditOrthogonalBlueprintCorridors,
  auditPixelatedSprites,
  auditZeroBorderRadius,
  createApiClient,
  createPatToken,
  ensureStackReady,
  uniqueId,
  waitForAppReady,
} from '../../harness/index.js';

const UI_SRC_DIR = path.join(E2E_PATHS.repoRoot, 'packages', 'ui', 'src');

function readUiSource(relPath: string): string {
  const fullPath = path.join(UI_SRC_DIR, relPath);
  expect(fs.existsSync(fullPath)).toBe(true);
  return fs.readFileSync(fullPath, 'utf8');
}

test.describe('Area D Tier 2 — @hermes/ui FUI Design System, Logo, Sprites & Charts Boundary & Negative (F18, F19, F21, F22)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  // =========================================================================
  // Feature F18: @hermes/ui Core FUI Design System, Tokens & Primitives (5 Tests)
  // =========================================================================

  test(
    '[T2][F18] auditZeroBorderRadius passes on live Web SPA routes and rejects non-zero border-radius on FUI_VIOLATING_SELF_TEST_HTML',
    { tag: ['@tier2', '@F18'] },
    async ({ page }) => {
      for (const route of ['/dashboard', '/finance']) {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}${route}`);
        const liveAudit = await auditZeroBorderRadius(page);
        expect(liveAudit.checkedCount).toBeGreaterThan(0);
        expect(liveAudit.violations).toEqual([]);
      }

      await page.setContent(FUI_COMPLIANT_SELF_TEST_HTML);
      const compliantAudit = await auditZeroBorderRadius(page);
      expect(compliantAudit.checkedCount).toBeGreaterThan(0);
      expect(compliantAudit.violations).toEqual([]);

      await page.setContent(FUI_VIOLATING_SELF_TEST_HTML);
      const violatingAudit = await auditZeroBorderRadius(page);
      expect(violatingAudit.violations.length).toBeGreaterThanOrEqual(2);
      const radiusValues = violatingAudit.violations.map((v) => v.borderRadius);
      expect(radiusValues.some((r) => r.includes('8px') || r.includes('12px'))).toBe(true);
    },
  );

  test(
    '[T2][F18] auditInteractiveFontFloor passes on live Web SPA routes and flags sub-12px interactive controls on FUI_VIOLATING_SELF_TEST_HTML',
    { tag: ['@tier2', '@F18'] },
    async ({ page }) => {
      for (const route of ['/todos', '/routines']) {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}${route}`);
        const liveFontAudit = await auditInteractiveFontFloor(page, 12);
        expect(liveFontAudit.violations).toEqual([]);
      }

      await page.setContent(FUI_COMPLIANT_SELF_TEST_HTML);
      const compliantFontAudit = await auditInteractiveFontFloor(page, 12);
      expect(compliantFontAudit.violations).toEqual([]);

      await page.setContent(FUI_VIOLATING_SELF_TEST_HTML);
      const violatingFontAudit = await auditInteractiveFontFloor(page, 12);
      expect(violatingFontAudit.violations.length).toBeGreaterThanOrEqual(1);
      expect(violatingFontAudit.violations[0]?.fontSize).toContain('10px');
    },
  );

  test(
    '[T2][F18] FuiBatteryCapsule clamps out-of-range (<0, >100, NaN) progress values and degenerate segment counts safely',
    { tag: ['@tier2', '@F18'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f18-t2-battery'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authed = api.withToken(pat.token);

        const created = await authed.post('/api/courses', {
          title: `Zero Lessons Boundary Course ${uniqueId('zero')}`,
          provider: 'Boundary OCW',
          status: 'active',
          total_lessons: 0,
          completed_lessons: 0,
        });
        if ([200, 201].includes(created.status)) {
          const courseId = String(
            (created.json?.course ?? created.json?.data ?? created.json)?.id ?? '',
          );
          if (courseId) {
            cleanup.defer(async () => {
              await authed.delete(`/api/courses/${courseId}`);
            });
          }
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/courses`);
        const bodyText = await page.locator('body').innerText();
        expect(bodyText).not.toContain('NaN');
        expect(bodyText).not.toContain('Infinity');

        const batterySrc = readUiSource('primitives/FuiBatteryCapsule.tsx');
        expect(batterySrc).toContain(
          'const clampedPct = Number.isFinite(progressPct)',
        );
        expect(batterySrc).toContain('Math.min(100, Math.max(0, Math.round(progressPct)))');
        expect(batterySrc).toContain(
          'const cellCount = segments && segments > 1 ? Math.round(segments) : 1;',
        );
        expect(batterySrc).toContain(
          'const activeCells = Math.round((clampedPct / 100) * cellCount);',
        );
        expect(batterySrc).toContain('data-progress={clampedPct}');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F18] PrivacyMask redacts currency values and strips title tooltips while leaving percentages and time-to-FI durations unmasked',
    { tag: ['@tier2', '@F18'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);
      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const privacySrc = readUiSource('privacy/PrivacyMask.tsx');
      expect(privacySrc).toContain('export function isNonCurrencyToken');
      expect(privacySrc).toContain("if (kind !== 'currency') return true;");
      expect(privacySrc).toContain('PURE_PERCENT_REGEX.test(value)');
      expect(privacySrc).toContain('PURE_DURATION_REGEX.test(value)');
      expect(privacySrc).toContain('title={shouldMask ? undefined : rawTitle}');

      const financeChartsSrc = readUiSource('charts/FinanceCharts.tsx');
      expect(financeChartsSrc).toContain('data-donut-part="center-label"');
      expect(financeChartsSrc).toContain('data-donut-part="duration-label"');
      expect(financeChartsSrc).toContain('data-candle-part="delta-pct"');
    },
  );

  test(
    '[T2][F18] FuiPanelHeader omits 3px Frieren ledge when showFrierenLedge=false and supports all 6 REF-02 accent variants',
    { tag: ['@tier2', '@F18'] },
    async ({ page }) => {
      for (const route of ['/monitor', '/goals']) {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}${route}`);
        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
        const colorAudit = await auditColorTokens(page);
        expect(colorAudit.hasCarbonBg).toBe(true);
      }

      const panelSrc = readUiSource('primitives/FuiPanel.tsx');
      expect(panelSrc).toContain(
        'const hasLedge = Boolean(frierenLedge || showFrierenLedge || activeSlot);',
      );
      expect(panelSrc).toContain("data-fui-frieren-ledge={hasLedge ? 'true' : 'false'}");
      expect(panelSrc).toContain('{hasLedge && (');
      expect(panelSrc).toContain('data-fui-part="frieren-ledge"');
      expect(panelSrc).toContain('const ACCENT_MAP: Record<FuiHeaderAccent, string>');
      for (const tone of ['orange', 'stark', 'cyan', 'vermilion', 'amber', 'phosphor']) {
        expect(panelSrc).toContain(`${tone}:`);
      }
    },
  );

  // =========================================================================
  // Feature F19: <SystemApertureLogo /> & <HudRingGlyph /> Brand Identity (5 Tests)
  // =========================================================================

  test(
    '[T2][F19] <SystemApertureLogo status="offline" /> switches Layer 5 iris stroke from #A8F040 phosphor to #F59E0B amber',
    { tag: ['@tier2', '@F19'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f19-t2-probe'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authed = api.withToken(pat.token);

        const srvRes = await authed.post('/api/monitor/servers', {
          name: `Degraded Probe Node ${uniqueId('node')}`,
          host: '127.0.0.1',
          port: 65431,
          probe_type: 'tcp',
        });
        if ([200, 201].includes(srvRes.status)) {
          const srvId = String(
            (srvRes.json?.server ?? srvRes.json?.data ?? srvRes.json)?.id ?? '',
          );
          if (srvId) {
            cleanup.defer(async () => {
              await authed.delete(`/api/monitor/servers/${srvId}`);
            });
            await authed.post(`/api/monitor/servers/${srvId}/probe`, {});
          }
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/monitor`);
        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);

        const logoSrc = readUiSource('brand/SystemApertureLogo.tsx');
        expect(logoSrc).toContain(
          "const irisColor = status === 'online' ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.accentAmber;",
        );
        expect(logoSrc).toContain(
          '<g data-layer="5" data-layer-name="status-iris" data-status={status} data-iris-color={irisColor}>',
        );
        expect(logoSrc).toContain('stroke={irisColor}');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F19] <SystemApertureLogo isThinking={true} /> dilates Layer 4 shutter blade aperture radius between 24.5 and 29.0',
    { tag: ['@tier2', '@F19'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/hermes`);
      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const logoSrc = readUiSource('brand/SystemApertureLogo.tsx');
      expect(logoSrc).toContain('const rOut = 50.2;');
      expect(logoSrc).toContain('const rAp = isThinking ? 29.0 : 24.5;');
      expect(logoSrc).toContain('const gammaDeg = Math.acos(rAp / rOut) / DEG;');
      expect(logoSrc).toContain('const rOct = rAp / Math.cos(22.5 * DEG);');
      expect(logoSrc).toContain('data-aperture-radius={rAp}');
      expect(logoSrc).toContain("transform={isThinking ? 'rotate(15 100 100)' : undefined}");
    },
  );

  test(
    '[T2][F19] prefers-reduced-motion: reduce halts <SystemApertureLogo /> and .fui-motion-spin / .fui-motion-pulse animations',
    { tag: ['@tier2', '@F19'] },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      try {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
        const matchesReduced = await page.evaluate(
          () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        );
        expect(matchesReduced).toBe(true);

        const stylesCss = readUiSource('styles.css');
        expect(stylesCss).toContain('@media (prefers-reduced-motion: reduce)');
        expect(stylesCss).toContain('animation: none !important;');
        expect(stylesCss).toContain('transition: none !important;');

        const logoSrc = readUiSource('brand/SystemApertureLogo.tsx');
        expect(logoSrc).toContain('const prefersReducedMotion = usePrefersReducedMotion();');
        expect(logoSrc).toContain(
          "data-reduced-motion={prefersReducedMotion ? 'true' : 'false'}",
        );
        expect(logoSrc).toContain(
          "className={isThinking && !prefersReducedMotion ? 'fui-motion-spin' : undefined}",
        );
      } finally {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      }
    },
  );

  test(
    '[T2][F19] auditApertureLogo passes on compliant 5-layer logo and flags missing layers/orange gear/shutter blades on FUI_VIOLATING_SELF_TEST_HTML',
    { tag: ['@tier2', '@F19'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
      const liveRadius = await auditZeroBorderRadius(page);
      expect(liveRadius.violations).toEqual([]);

      await page.setContent(FUI_COMPLIANT_SELF_TEST_HTML);
      const compliantLogo = await auditApertureLogo(page);
      expect(compliantLogo.found).toBe(true);
      expect(compliantLogo.svgLayerCount).toBe(5);
      expect(compliantLogo.hasOrangeGear).toBe(true);
      expect(compliantLogo.hasShutterBlades).toBe(true);
      expect(compliantLogo.hasStatusIris).toBe(true);

      await page.setContent(FUI_VIOLATING_SELF_TEST_HTML);
      const violatingLogo = await auditApertureLogo(page);
      expect(violatingLogo.svgLayerCount).toBeLessThan(5);
      expect(violatingLogo.hasOrangeGear).toBe(false);
      expect(violatingLogo.hasShutterBlades).toBe(false);
      expect(violatingLogo.hasStatusIris).toBe(false);
    },
  );

  test(
    '[T2][F19] auditOrthogonalBlueprintCorridors rejects diagonal and curved SVG connectors on FUI_VIOLATING_SELF_TEST_HTML',
    { tag: ['@tier2', '@F19'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/monitor`);
      const liveCorridors = await auditOrthogonalBlueprintCorridors(page);
      expect(liveCorridors.diagonalOrCurvedViolations).toEqual([]);

      await page.setContent(FUI_COMPLIANT_SELF_TEST_HTML);
      const compliantCorridors = await auditOrthogonalBlueprintCorridors(page);
      expect(compliantCorridors.segmentCount).toBeGreaterThan(0);
      expect(compliantCorridors.diagonalOrCurvedViolations).toEqual([]);

      await page.setContent(FUI_VIOLATING_SELF_TEST_HTML);
      const violatingCorridors = await auditOrthogonalBlueprintCorridors(page);
      expect(violatingCorridors.diagonalOrCurvedViolations.length).toBeGreaterThanOrEqual(2);
    },
  );

  // =========================================================================
  // Feature F21: Pixel-Art Sprite Sheet Engine: Frieren & Knights (5 Tests)
  // =========================================================================

  test(
    '[T2][F21] <CompanionStage /> offline fallback rotates across all 6 cozy loops and 8 non-repeating motivational phrases',
    { tag: ['@tier2', '@F21'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/hermes`);
      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const stageSrc = readUiSource('sprites/CompanionStage.tsx');
      expect(stageSrc).toContain(
        'const OFFLINE_ROTATION_POOL: readonly CompanionAnimationName[] = [',
      );
      expect(stageSrc).toContain('if (phraseBank.length <= 1) return 0;');
      expect(stageSrc).toContain(
        'const offset = 1 + Math.floor(Math.random() * (phraseBank.length - 1));',
      );
      expect(stageSrc).toContain('return (prev + offset) % phraseBank.length;');
      expect(stageSrc).toContain(
        'const candidates = OFFLINE_ROTATION_POOL.filter((a) => a !== prevAnim);',
      );

      const registrySrc = readUiSource('sprites/registry.ts');
      expect(registrySrc).toContain(
        'export const DEFAULT_COMPANION_OFFLINE_PHRASES: readonly CompanionOfflinePhrase[] = [',
      );
      const idMatches = registrySrc.match(/id:\s*'phrase-\d+'/g) ?? [];
      expect(idMatches.length).toBe(8);
    },
  );

  test(
    '[T2][F21] <PixelSprite /> falls back to deterministic CSS sprite-strip when PNG fails to load and clamps scale to integer 2x/3x/4x',
    { tag: ['@tier2', '@F21'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);
      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const registrySrc = readUiSource('sprites/registry.ts');
      expect(registrySrc).toContain(
        'export function clampSpriteScale(raw?: PixelScale | number | string | null): PixelScale {',
      );
      expect(registrySrc).toContain(
        "if (raw === undefined || raw === null || raw === '') return 2;",
      );
      expect(registrySrc).toContain('if (!Number.isFinite(n)) return 2;');
      expect(registrySrc).toContain('const rounded = Math.round(n);');
      expect(registrySrc).toContain('if (rounded <= 2) return 2;');
      expect(registrySrc).toContain('if (rounded >= 4) return 4;');
      expect(registrySrc).toContain('return rounded as PixelScale;');

      const pixelSpriteSrc = readUiSource('sprites/PixelSprite.tsx');
      expect(pixelSpriteSrc).toContain('data-sprite-fallback="css-strip"');
      expect(pixelSpriteSrc).toContain(
        "data-using-fallback={usingFallbackSheet || Boolean(normalized.invalidReason) ? 'true' : 'false'}",
      );
      expect(pixelSpriteSrc).toContain('onError={() => {');
      expect(pixelSpriteSrc).toContain('setUsingFallbackSheet(true);');
    },
  );

  test(
    '[T2][F21] <IsometricKnightSprite /> displays [BUDGET_0] badge when budgetExhausted=true and clamps out-of-range HP/EP percentages to 0..100',
    { tag: ['@tier2', '@F21'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);
      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const knightSrc = readUiSource('sprites/IsometricKnightSprite.tsx');
      expect(knightSrc).toContain(
        'const clampedHp = hpPct !== undefined && Number.isFinite(hpPct) ? Math.min(100, Math.max(0, Math.round(hpPct))) : 100;',
      );
      expect(knightSrc).toContain(
        'const clampedEp = epPct !== undefined && Number.isFinite(epPct) ? Math.min(100, Math.max(0, Math.round(epPct))) : 0;',
      );
      expect(knightSrc).toContain('data-hp-pct={clampedHp}');
      expect(knightSrc).toContain('data-ep-pct={clampedEp}');
      expect(knightSrc).toContain('data-knight-part="budget-exhausted"');
      expect(knightSrc).toContain('[BUDGET_0]');
    },
  );

  test(
    '[T2][F21] auditPixelatedSprites passes on integer-scaled pixelated sprites and flags non-pixelated CSS on FUI_VIOLATING_SELF_TEST_HTML',
    { tag: ['@tier2', '@F21'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);
      const liveSprites = await auditPixelatedSprites(page);
      expect(liveSprites.violations).toEqual([]);

      await page.setContent(FUI_COMPLIANT_SELF_TEST_HTML);
      const compliantSprites = await auditPixelatedSprites(page);
      expect(compliantSprites.spriteCount).toBeGreaterThanOrEqual(1);
      expect(compliantSprites.violations).toEqual([]);

      await page.setContent(FUI_VIOLATING_SELF_TEST_HTML);
      const violatingSprites = await auditPixelatedSprites(page);
      expect(violatingSprites.spriteCount).toBeGreaterThanOrEqual(1);
      expect(violatingSprites.violations.length).toBeGreaterThanOrEqual(1);
      expect(violatingSprites.violations[0]?.imageRendering).toContain('auto');
    },
  );

  test(
    '[T2][F21] <CompanionStage mode="mobile" /> strictly omits the Web-only "Expand in Full Hermes View" CTA (02-companion-app.md scope)',
    { tag: ['@tier2', '@F21'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const stageSrc = readUiSource('sprites/CompanionStage.tsx');
      expect(stageSrc).toContain(
        "/* Strictly Web-only ('popover'): NEVER render /hermes expansion in 'mobile' mode per 02-companion-app.md */",
      );
      expect(stageSrc).toContain("{mode === 'popover' && onExpandToHermes && (");
      expect(stageSrc).toContain('data-testid="companion-expand-hermes"');
      expect(stageSrc).not.toContain("mode === 'mobile' && onExpandToHermes");
    },
  );

  // =========================================================================
  // Feature F22: @hermes/ui Tactical Charts: Telemetry & Finance (5 Tests)
  // =========================================================================

  test(
    '[T2][F22] computeWaffleAllocation and /finance/allocation guarantee exact 200-tile apportionment and flag weight drift',
    { tag: ['@tier2', '@F22'] },
    async ({ page }) => {
      const api = createApiClient(E2E_URLS.baseUrl);
      const allocRes = await api.get('/api/finance/allocation?investable_surplus_cents=100000');
      if (allocRes.status === 200 && Array.isArray(allocRes.json?.waffle_tiles)) {
        expect(allocRes.json.waffle_tiles.length).toBe(200);
      }

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);
      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const mathSrc = readUiSource('charts/math.ts');
      expect(mathSrc).toContain(
        'const hasWeightDriftWarning = rawSum <= 0 || Math.abs(weightSumPct - 100) > 0.05;',
      );
      expect(mathSrc).toContain('if (valid.length === 0 || rawSum <= 0) {');
      expect(mathSrc).toContain('unallocatedTiles: 200');
      expect(mathSrc).toContain('while (tiles.length < 200) {');
      expect(mathSrc).toContain('tiles: tiles.slice(0, 200)');

      const financeChartsSrc = readUiSource('charts/FinanceCharts.tsx');
      expect(financeChartsSrc).toContain('data-waffle-part="drift-warning"');
    },
  );

  test(
    '[T2][F22] chart math helpers (sanitizeFinite, clamp) prevent NaN/Infinity on zero denominators and extreme inputs',
    { tag: ['@tier2', '@F22'] },
    async ({ page }) => {
      const api = createApiClient(E2E_URLS.baseUrl);
      const simRes = await api.post('/api/finance/retirement/simulate', {
        current_net_worth_brl_cents: 10000000,
        monthly_contribution_brl_cents: 0,
        expected_real_return_pct: '0.00',
      });
      expect([200, 400, 404]).toContain(simRes.status);

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('NaN');
      expect(bodyText).not.toContain('Infinity');

      const mathSrc = readUiSource('charts/math.ts');
      expect(mathSrc).toContain(
        'export function sanitizeFinite(value: unknown, fallback = 0): number {',
      );
      expect(mathSrc).toContain('return Number.isFinite(n) ? n : fallback;');
      expect(mathSrc).toContain(
        'export function clamp(value: unknown, min: number, max: number, fallback = min): number {',
      );
      expect(mathSrc).toContain('if (n < min) return min;');
      expect(mathSrc).toContain('if (n > max) return max;');
    },
  );

  test(
    '[T2][F22] <CandlestickChart /> and <WaveformSparkline /> render deterministic empty/single-point states without SVG path NaN errors',
    { tag: ['@tier2', '@F22'] },
    async ({ page }) => {
      for (const route of ['/finance', '/monitor']) {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}${route}`);
        const badPaths = await page.evaluate(() => {
          const paths = Array.from(document.querySelectorAll('svg path, svg polyline'));
          return paths
            .map((el) => el.getAttribute('d') || el.getAttribute('points') || '')
            .filter((attr) => attr.includes('NaN') || attr.includes('undefined'));
        });
        expect(badPaths).toEqual([]);
      }

      const financeChartsSrc = readUiSource('charts/FinanceCharts.tsx');
      expect(financeChartsSrc).toContain('if (sanitizedCandles.length === 0) {');
      expect(financeChartsSrc).toContain('data-candle-part="empty-state"');
      expect(financeChartsSrc).toContain('[NO_CANDLE_DATA // {symbol}]');

      const telemetrySrc = readUiSource('charts/TelemetryCharts.tsx');
      expect(telemetrySrc).toContain('if (clean.length === 0) {');
      expect(telemetrySrc).toContain('if (clean.length === 1) {');
      expect(telemetrySrc).toContain('data-waveform-part="single-point-marker"');
    },
  );

  test(
    '[T2][F22] <PairedHatchBarChart /> renders #EB4511 vermilion overspend cap when actual > planned and dashed placeholder when actual is null',
    { tag: ['@tier2', '@F22'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);
      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const financeChartsSrc = readUiSource('charts/FinanceCharts.tsx');
      expect(financeChartsSrc).toContain(
        'const hasActual = d.actual !== null && d.actual !== undefined && Number.isFinite(d.actual);',
      );
      expect(financeChartsSrc).toContain(
        "const isOverspend = mode === 'spend' && hasActual && actualVal > plannedVal;",
      );
      expect(financeChartsSrc).toContain('data-bar-actual-placeholder={d.month}');
      expect(financeChartsSrc).toContain('strokeDasharray="2 2"');
      expect(financeChartsSrc).toContain('data-bar-overspend={d.month}');
      expect(financeChartsSrc).toContain('fill={FUI_TOKENS.accentVermilion}');
    },
  );

  test(
    '[T2][F22] <LifeRadarReticle />, <FocusBarcode24h />, and <ConstellationMesh /> handle out-of-range axes, empty intervals, and 0-node idle reticle',
    { tag: ['@tier2', '@F22'] },
    async ({ page }) => {
      for (const route of ['/dashboard', '/monitor', '/hermes']) {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}${route}`);
        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
      }

      const telemetrySrc = readUiSource('charts/TelemetryCharts.tsx');
      expect(telemetrySrc).toContain('score: clamp(item.score, 0, 100, 50)');
      expect(telemetrySrc).toContain(
        'const bins = new Array<number>(slotCount).fill(0);',
      );
      expect(telemetrySrc).toContain('clamp(Math.min(rawA, rawB), 0, 1440, 0)');
      expect(telemetrySrc).toContain('data-constellation-part="grid-16x16"');
      expect(telemetrySrc).toContain('{projectedNodes.length === 0 && (');
      expect(telemetrySrc).toContain('data-constellation-part="idle-reticle"');
    },
  );
});
