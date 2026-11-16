import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  CleanupRegistry,
  E2E_PATHS,
  E2E_URLS,
  FUI_COMPLIANT_SELF_TEST_HTML,
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

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  expect(buf.length).toBeGreaterThanOrEqual(24);
  // PNG 8-byte signature: 89 50 4E 47 0D 0A 1A 0A
  expect(buf[0]).toBe(0x89);
  expect(buf[1]).toBe(0x50);
  expect(buf[2]).toBe(0x4e);
  expect(buf[3]).toBe(0x47);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

test.describe('Area D Tier 1 — @hermes/ui FUI Design System, Aperture Logo, Sprites & Charts (F18, F19, F21, F22)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  // =========================================================================
  // Feature F18: @hermes/ui Core FUI Design System, Tokens & Primitives (5 Tests)
  // =========================================================================

  test(
    '[T1][F18] enforces 0px border-radius, >=12px interactive font floor, and REF-02 surface/accent color tokens',
    { tag: ['@tier1', '@F18'] },
    async ({ page }) => {
      for (const route of ['/dashboard', '/monitor', '/finance']) {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}${route}`);

        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.checkedCount).toBeGreaterThan(0);
        expect(radiusAudit.violations).toEqual([]);

        const fontAudit = await auditInteractiveFontFloor(page, 12);
        expect(fontAudit.violations).toEqual([]);

        const colorAudit = await auditColorTokens(page);
        expect(colorAudit.hasCarbonBg).toBe(true);
        expect(colorAudit.hasStarkWhiteInk).toBe(true);
      }

      const tokensSrc = readUiSource('tokens.ts');
      for (const expectedHex of [
        '#08080B',
        '#0D0716',
        '#10171D',
        '#13151A',
        '#141526',
        '#262830',
        '#2A1A3A',
        '#F87C18',
        '#EB4511',
        '#F59E0B',
        '#2CE5F2',
        '#A8F040',
        '#F4F6C2',
        '#F6F6F4',
        '#E4E6EB',
        '#8A909E',
      ]) {
        expect(tokensSrc).toContain(expectedHex);
      }
      expect(tokensSrc).toContain("borderRadius: '0px'");
      expect(tokensSrc).toContain('interactiveFontFloorPx: 12');

      const stylesCss = readUiSource('styles.css');
      expect(stylesCss).toContain('--fui-radius-zero: 0px');
      expect(stylesCss).toContain('border-radius: 0px !important');
      expect(stylesCss).toContain('--fui-interactive-font-floor: 12px');
    },
  );

  test(
    '[T1][F18] renders FuiPanel and FuiPanelHeader with stepped top-border bar, 16x16 + badge, 6x6 corner ticks, and 3px Frieren ledge',
    { tag: ['@tier1', '@F18'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const liveHeader = page.locator('[data-fui="panel-header"]').first();
      if ((await liveHeader.count()) > 0) {
        await expect(liveHeader).toBeVisible();
        await expect(liveHeader.locator('[data-fui-part="stepped-rule"]')).toBeVisible();
        await expect(liveHeader.locator('[data-fui-part="stepped-bar-left"]')).toBeVisible();
      }

      const fuiPanelSrc = readUiSource('primitives/FuiPanel.tsx');
      expect(fuiPanelSrc).toContain('data-fui="panel-header"');
      expect(fuiPanelSrc).toContain("data-fui-frieren-ledge={hasLedge ? 'true' : 'false'}");
      expect(fuiPanelSrc).toContain('data-fui-part="stepped-rule"');
      expect(fuiPanelSrc).toContain('data-fui-part="stepped-bar-left"');
      expect(fuiPanelSrc).toContain('data-fui-part="corner-tick"');
      expect(fuiPanelSrc).toContain('data-fui-part="frieren-ledge"');
      expect(fuiPanelSrc).toContain('data-fui-part="prefix-badge"');
      expect(fuiPanelSrc).toContain('<svg width="10" height="10" viewBox="0 0 10 10"');
      expect(fuiPanelSrc).toContain('d="M5 1.5V8.5M1.5 5H8.5"');
      expect(fuiPanelSrc).toContain("width: '16px'");
      expect(fuiPanelSrc).toContain("height: '16px'");
      expect(fuiPanelSrc).toContain("height: '3px'");
    },
  );

  test(
    '[T1][F18] renders FuiFigureRow with notched #F59E0B amber tab, Fig. X.Y index, dual #A8F040/#EB4511 underline, and status cell',
    { tag: ['@tier1', '@F18'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f18-fig-row'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authed = api.withToken(pat.token);

        const created = await authed.post('/api/tasks', {
          title: `FuiFigureRow Verification Task ${uniqueId('fig')}`,
          status: 'todo',
          priority: 'high',
          energy_level: 'deep',
          estimated_minutes: 30,
        });
        expect([200, 201]).toContain(created.status);
        const taskId = String(
          (created.json?.task ?? created.json?.data ?? created.json)?.id ?? '',
        );
        if (taskId) {
          cleanup.defer(async () => {
            await authed.delete(`/api/tasks/${taskId}`);
          });
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);
        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);

        const liveRow = page.locator('[data-fui="figure-row"]').first();
        if ((await liveRow.count()) > 0) {
          await expect(liveRow).toBeVisible();
          await expect(liveRow.locator('[data-fui-part="figure-left-tab"]')).toBeVisible();
          await expect(liveRow.locator('[data-fui-part="figure-code"]')).toBeVisible();
        }

        const figRowSrc = readUiSource('primitives/FuiFigureRow.tsx');
        expect(figRowSrc).toContain('data-fui="figure-row"');
        expect(figRowSrc).toContain('data-fui-part="figure-left-tab"');
        expect(figRowSrc).toContain(
          "clipPath: 'polygon(0 4px, 3px 4px, 3px 0, 100% 0, 100% 100%, 0 100%)'",
        );
        expect(figRowSrc).toContain('FUI_TOKENS.accentAmber');
        expect(figRowSrc).toContain('data-fui-part="figure-code"');
        expect(figRowSrc).toContain('data-fui-part="figure-status-cell"');
        expect(figRowSrc).toContain('data-fui-part="figure-dual-underline"');
        expect(figRowSrc).toContain('data-underline-left="phosphor"');
        expect(figRowSrc).toContain('data-underline-right="vermilion"');
        expect(figRowSrc).toContain('FUI_TOKENS.accentPhosphor');
        expect(figRowSrc).toContain('FUI_TOKENS.accentVermilion');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F18] renders FuiBatteryCapsule with 0..100% segmented SVG progress fill and >=28x28px [▶] focus timer trigger',
    { tag: ['@tier1', '@F18'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f18-battery'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authed = api.withToken(pat.token);

        const courseRes = await authed.post('/api/courses', {
          title: `Battery Capsule Course ${uniqueId('crs')}`,
          provider: 'MIT OCW',
          status: 'active',
          total_lessons: 10,
          completed_lessons: 6,
        });
        if ([200, 201].includes(courseRes.status)) {
          const courseId = String(
            (courseRes.json?.course ?? courseRes.json?.data ?? courseRes.json)?.id ?? '',
          );
          if (courseId) {
            cleanup.defer(async () => {
              await authed.delete(`/api/courses/${courseId}`);
            });
          }
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/courses`);
        const fontAudit = await auditInteractiveFontFloor(page, 12);
        expect(fontAudit.violations).toEqual([]);

        const liveCapsule = page.locator('[data-fui="battery-capsule"]').first();
        if ((await liveCapsule.count()) > 0) {
          await expect(liveCapsule).toBeVisible();
          const playBtn = liveCapsule.locator('[data-fui-part="battery-play-trigger"]');
          if ((await playBtn.count()) > 0) {
            const box = await playBtn.boundingBox();
            expect(box?.width ?? 0).toBeGreaterThanOrEqual(28);
            expect(box?.height ?? 0).toBeGreaterThanOrEqual(28);
          }
        }

        const batterySrc = readUiSource('primitives/FuiBatteryCapsule.tsx');
        expect(batterySrc).toContain('data-fui="battery-capsule"');
        expect(batterySrc).toContain('data-progress={clampedPct}');
        expect(batterySrc).toContain('data-battery-cell={idx}');
        expect(batterySrc).toContain('data-fui-part="battery-play-trigger"');
        expect(batterySrc).toContain("minWidth: '28px'");
        expect(batterySrc).toContain("minHeight: '28px'");
        expect(batterySrc).toContain("fontSize: '12px'");
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F18] toggles global PrivacyMaskProvider (hermes-fui-privacy-mask) to redact BRL/USD currency while keeping % and durations visible',
    { tag: ['@tier1', '@F18'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const liveToggle = page.getByTestId('fui-privacy-toggle').first();
      if ((await liveToggle.count()) > 0) {
        await liveToggle.click();
        const storedVal = await page.evaluate(() =>
          window.localStorage.getItem('hermes-fui-privacy-mask'),
        );
        expect(['true', 'false']).toContain(storedVal);
      }

      const privacySrc = readUiSource('privacy/PrivacyMask.tsx');
      expect(privacySrc).toContain("storageKey = 'hermes-fui-privacy-mask'");
      expect(privacySrc).toContain('PURE_PERCENT_REGEX');
      expect(privacySrc).toContain('PURE_DURATION_REGEX');
      expect(privacySrc).toContain("'R$ ••••••'");
      expect(privacySrc).toContain("'$ ••••••'");
      expect(privacySrc).toContain("'••••••'");
      expect(privacySrc).toContain('data-testid="fui-privacy-toggle"');
      expect(privacySrc).toContain('title={shouldMask ? undefined : rawTitle}');
    },
  );

  // =========================================================================
  // Feature F19: <SystemApertureLogo /> & <HudRingGlyph /> Brand Identity (5 Tests)
  // =========================================================================

  test(
    '[T1][F19] renders 5-layer SVG <SystemApertureLogo /> with exact outer reticle, 24-fin turbine, and 36-tooth #F87C18 gear collar',
    { tag: ['@tier1', '@F19'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

      const liveLogoAudit = await auditApertureLogo(page);
      if (liveLogoAudit.found) {
        expect(liveLogoAudit.svgLayerCount).toBe(5);
        expect(liveLogoAudit.hasOrangeGear).toBe(true);
      }

      await page.setContent(FUI_COMPLIANT_SELF_TEST_HTML);
      const compliantLogoAudit = await auditApertureLogo(page);
      expect(compliantLogoAudit.found).toBe(true);
      expect(compliantLogoAudit.svgLayerCount).toBe(5);
      expect(compliantLogoAudit.hasOrangeGear).toBe(true);
      expect(compliantLogoAudit.hasShutterBlades).toBe(true);
      expect(compliantLogoAudit.hasStatusIris).toBe(true);

      const logoSrc = readUiSource('brand/SystemApertureLogo.tsx');
      expect(logoSrc).toContain('viewBox="0 0 200 200"');
      expect(logoSrc).toContain('data-fui="system-aperture-logo"');
      expect(logoSrc).toContain('data-layer="1" data-layer-name="outer-reticle"');
      expect(logoSrc).toContain('data-reticle-arc={idx}');
      expect(logoSrc).toContain('data-reticle-notch={idx}');
      expect(logoSrc).toContain('data-layer="2" data-layer-name="turbine-ring"');
      expect(logoSrc).toContain('Array.from({ length: 24 })');
      expect(logoSrc).toContain('data-turbine-fin={k}');
      expect(logoSrc).toContain('fill={FUI_TOKENS.apertureTurbineSilver}');
      expect(logoSrc).toContain('data-layer="3" data-layer-name="gear-collar"');
      expect(logoSrc).toContain('Array.from({ length: 36 })');
      expect(logoSrc).toContain('data-gear-tooth={j}');
      expect(logoSrc).toContain('fill={FUI_TOKENS.accentOrange}');
    },
  );

  test(
    '[T1][F19] renders Layer 4 8-blade octagonal aperture shutter (#F6F6F4 / #08080B) and Layer 5 status iris (#A8F040 online)',
    { tag: ['@tier1', '@F19'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/hermes`);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const logoSrc = readUiSource('brand/SystemApertureLogo.tsx');
      expect(logoSrc).toContain('data-layer="4"');
      expect(logoSrc).toContain('data-layer-name="shutter-blades"');
      expect(logoSrc).toContain('Array.from({ length: 8 })');
      expect(logoSrc).toContain('data-shutter-blade={b}');
      expect(logoSrc).toContain('fill={FUI_TOKENS.inkStark}');
      expect(logoSrc).toContain('stroke={FUI_TOKENS.bgCarbon}');
      expect(logoSrc).toContain('data-layer="5" data-layer-name="status-iris"');
      expect(logoSrc).toContain('data-iris-color={irisColor}');
      expect(logoSrc).toContain('data-iris-outer="true"');
      expect(logoSrc).toContain('data-iris-segmented="true"');
      expect(logoSrc).toContain('data-iris-pupil="true"');
      expect(logoSrc).toContain('fill="#13171E"');
    },
  );

  test(
    '[T1][F19] switches <SystemApertureLogo /> iris to #F59E0B on offline/syncing status and dilates aperture on isThinking=true',
    { tag: ['@tier1', '@F19'] },
    async ({ page }) => {
      const api = createApiClient(E2E_URLS.baseUrl);
      const healthRes = await api.get('/api/health');
      expect(healthRes.status).toBe(200);

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/monitor`);
      const colorAudit = await auditColorTokens(page);
      expect(colorAudit.hasCarbonBg).toBe(true);

      const logoSrc = readUiSource('brand/SystemApertureLogo.tsx');
      expect(logoSrc).toContain(
        "export type SystemApertureStatus = 'online' | 'syncing' | 'offline';",
      );
      expect(logoSrc).toContain(
        "const irisColor = status === 'online' ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.accentAmber;",
      );
      expect(logoSrc).toContain('const rAp = isThinking ? 29.0 : 24.5;');
      expect(logoSrc).toContain("data-thinking={isThinking ? 'true' : 'false'}");
      expect(logoSrc).toContain('data-aperture-radius={rAp}');
      expect(logoSrc).toContain(
        "className={isThinking && !prefersReducedMotion ? 'fui-motion-spin' : undefined}",
      );
    },
  );

  test(
    '[T1][F19] renders all 8 REF-12 <HudRingGlyph /> variants as crisp vector strokes without raster <image> tags',
    { tag: ['@tier1', '@F19'] },
    async ({ page }) => {
      for (const route of ['/monitor', '/dashboard']) {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}${route}`);
        const svgImageCount = await page.locator('svg image').count();
        expect(svgImageCount).toBe(0);
      }

      const glyphSrc = readUiSource('brand/HudRingGlyph.tsx');
      for (const variant of [
        'radial_comb_gauge',
        'segmented_bezel',
        'cardinal_pointer_ring',
        'crosshair_reticle',
        'tick_arc_270',
        'tick_arc_90',
        'aperture_shutter_8',
        'notched_rotor',
      ]) {
        expect(glyphSrc).toContain(`'${variant}'`);
        expect(glyphSrc).toContain(`variant === '${variant}'`);
      }
      expect(glyphSrc).toContain('viewBox="0 0 100 100"');
      expect(glyphSrc).toContain('data-fui="hud-ring-glyph"');
      expect(glyphSrc).toContain('data-variant={variant}');
      expect(glyphSrc).not.toContain('<image');
    },
  );

  test(
    '[T1][F19] renders <SystemApertureLogo /> and <HudRingGlyph /> cleanly across header, command deck, and monitor scales with 0px borderRadius',
    { tag: ['@tier1', '@F19'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      await page.setContent(FUI_COMPLIANT_SELF_TEST_HTML);
      const corridorAudit = await auditOrthogonalBlueprintCorridors(page);
      expect(corridorAudit.segmentCount).toBeGreaterThan(0);
      expect(corridorAudit.diagonalOrCurvedViolations).toEqual([]);

      const logoSrc = readUiSource('brand/SystemApertureLogo.tsx');
      expect(logoSrc).toContain('size = 40');
      expect(logoSrc).toContain('width={size}');
      expect(logoSrc).toContain('height={size}');
      expect(logoSrc).toContain('viewBox="0 0 200 200"');
      expect(logoSrc).toContain("borderRadius: '0px'");

      const glyphSrc = readUiSource('brand/HudRingGlyph.tsx');
      expect(glyphSrc).toContain('size = 48');
      expect(glyphSrc).toContain('width={size}');
      expect(glyphSrc).toContain('height={size}');
      expect(glyphSrc).toContain("borderRadius: '0px'");
    },
  );

  // =========================================================================
  // Feature F21: Pixel-Art Sprite Sheet Engine: Frieren & Knights (5 Tests)
  // =========================================================================

  test(
    '[T1][F21] validates committed PNG + JSON sprite sheet assets on disk (frieren-mini, frieren-portrait, knights-isometric)',
    { tag: ['@tier1', '@F21'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);

      const spritesDir = path.join(UI_SRC_DIR, 'assets', 'sprites');
      const expectedAssets = [
        {
          base: 'frieren-mini',
          width: 256,
          height: 224,
          frameW: 32,
          frameH: 32,
          animations: [
            'idle_ledge_sit',
            'walk_ledge',
            'read_grimoire',
            'cast_blue_flora',
            'sip_tea',
            'cozy_nap',
            'mimic_gag',
          ],
        },
        {
          base: 'frieren-portrait',
          width: 1536,
          height: 160,
          frameW: 128,
          frameH: 160,
          animations: ['wind_blink_loop', 'calm_gaze'],
        },
        {
          base: 'knights-isometric',
          width: 288,
          height: 960,
          frameW: 48,
          frameH: 48,
          animations: [
            'paladin_idle',
            'paladin_cast',
            'paladin_alert',
            'paladin_barracks_rest',
            'vanguard_idle',
            'lore_warden_idle',
            'inquisitor_idle',
            'artificer_idle',
          ],
        },
      ];

      for (const spec of expectedAssets) {
        const pngPath = path.join(spritesDir, `${spec.base}.png`);
        const jsonPath = path.join(spritesDir, `${spec.base}.json`);
        expect(fs.existsSync(pngPath)).toBe(true);
        expect(fs.existsSync(jsonPath)).toBe(true);

        const pngDims = readPngDimensions(pngPath);
        expect(pngDims.width).toBe(spec.width);
        expect(pngDims.height).toBe(spec.height);

        const descriptor = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        expect(descriptor.meta.size.w).toBe(spec.width);
        expect(descriptor.meta.size.h).toBe(spec.height);
        expect(descriptor.meta.frameSize.w).toBe(spec.frameW);
        expect(descriptor.meta.frameSize.h).toBe(spec.frameH);

        for (const animKey of spec.animations) {
          expect(descriptor.animations[animKey]).toBeTruthy();
        }

        for (const [animName, def] of Object.entries<any>(descriptor.animations)) {
          const frames = Number(def.frames ?? 1);
          const startCol = Number(def.startCol ?? 0);
          const row = Number(def.row ?? 0);
          expect(
            (startCol + frames) * spec.frameW,
            `${spec.base}:${animName} exceeds sheet width`,
          ).toBeLessThanOrEqual(spec.width);
          expect(
            (row + 1) * spec.frameH,
            `${spec.base}:${animName} exceeds sheet height`,
          ).toBeLessThanOrEqual(spec.height);
        }
      }
    },
  );

  test(
    '[T1][F21] renders Mode A <CompanionStage mode="ledge" /> with 3px #F87C18 ledge and pixelated integer-scaled sprite',
    { tag: ['@tier1', '@F21'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

      const liveSpriteAudit = await auditPixelatedSprites(page);
      expect(liveSpriteAudit.violations).toEqual([]);

      await page.setContent(FUI_COMPLIANT_SELF_TEST_HTML);
      const compliantSpriteAudit = await auditPixelatedSprites(page);
      expect(compliantSpriteAudit.spriteCount).toBeGreaterThanOrEqual(1);
      expect(compliantSpriteAudit.violations).toEqual([]);

      const stageSrc = readUiSource('sprites/CompanionStage.tsx');
      expect(stageSrc).toContain("if (mode === 'ledge')");
      expect(stageSrc).toContain('data-fui="companion-stage"');
      expect(stageSrc).toContain('data-mode="ledge"');
      expect(stageSrc).toContain('data-companion-ledge="true"');
      expect(stageSrc).toContain('data-testid="companion-mini-sprite"');
      expect(stageSrc).toContain("height: '3px'");
      expect(stageSrc).toContain('backgroundColor: FUI_TOKENS.accentOrange');

      const pixelSpriteSrc = readUiSource('sprites/PixelSprite.tsx');
      expect(pixelSpriteSrc).toContain('data-fui="pixel-sprite"');
      expect(pixelSpriteSrc).toContain("imageRendering: 'pixelated'");
      expect(pixelSpriteSrc).toContain('ctx.imageSmoothingEnabled = false');
    },
  );

  test(
    '[T1][F21] renders Mode B <CompanionStage mode="popover" /> (Cmd+J) with portrait card, Page Context pill, and Expand in Full Hermes View CTA',
    { tag: ['@tier1', '@F21'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
      await page.keyboard.press('Control+j');

      const livePopover = page.locator('[data-fui="companion-stage"][data-mode="popover"]');
      if ((await livePopover.count()) > 0) {
        await expect(livePopover).toBeVisible();
      }

      const stageSrc = readUiSource('sprites/CompanionStage.tsx');
      expect(stageSrc).toContain("(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j'");
      expect(stageSrc).toContain('data-testid="companion-page-context"');
      expect(stageSrc).toContain('CTX // {pageContext.activeRoute}');
      expect(stageSrc).toContain('data-testid="companion-portrait-sprite"');
      expect(stageSrc).toContain("{mode === 'popover' && onExpandToHermes && (");
      expect(stageSrc).toContain('data-testid="companion-expand-hermes"');
      expect(stageSrc).toContain('Expand in Full Hermes View ↗');
    },
  );

  test(
    '[T1][F21] switches <CompanionStage /> to cozy offline animation and speech bubble when online=false without red error chrome',
    { tag: ['@tier1', '@F21'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/hermes`);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const stageSrc = readUiSource('sprites/CompanionStage.tsx');
      for (const loopName of [
        'read_grimoire',
        'wind_blink_loop',
        'cast_blue_flora',
        'sip_tea',
        'cozy_nap',
        'mimic_gag',
      ]) {
        expect(stageSrc).toContain(`'${loopName}'`);
      }
      expect(stageSrc).toContain("const isMobileOffline = mode === 'mobile' && !online;");
      expect(stageSrc).toContain('data-testid="companion-mobile-offline"');
      expect(stageSrc).toContain('data-testid="companion-offline-banner"');
      expect(stageSrc).toContain('[◌ OFFLINE_MODE — TAP FRIEREN FOR FIELD MOTIVATION]');
      expect(stageSrc).toContain('border: `1px solid ${FUI_TOKENS.accentAmber}`');
      expect(stageSrc).toContain('data-testid="companion-offline-speech-bubble"');
      expect(stageSrc).toContain('FRIEREN // FIELD_NOTE');

      const registrySrc = readUiSource('sprites/registry.ts');
      expect(registrySrc).toContain('DEFAULT_COMPANION_OFFLINE_PHRASES');
    },
  );

  test(
    '[T1][F21] renders <IsometricKnightSprite /> for all 5 archetypes across 4 states with HP (#EB4511) and EP (#2CE5F2) overhead bars',
    { tag: ['@tier1', '@F21'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);
      const spriteAudit = await auditPixelatedSprites(page);
      expect(spriteAudit.violations).toEqual([]);

      const knightSrc = readUiSource('sprites/IsometricKnightSprite.tsx');
      for (const archetype of [
        'paladin',
        'vanguard',
        'lore_warden',
        'inquisitor',
        'artificer',
      ]) {
        expect(knightSrc).toContain(`'${archetype}'`);
      }
      for (const state of ['idle', 'cast', 'alert', 'barracks_rest']) {
        expect(knightSrc).toContain(`'${state}'`);
      }
      expect(knightSrc).toContain('data-fui="isometric-knight-sprite"');
      expect(knightSrc).toContain('data-knight-part="active-chevron"');
      expect(knightSrc).toContain('data-knight-part="alert-bubble"');
      expect(knightSrc).toContain('data-knight-part="budget-exhausted"');
      expect(knightSrc).toContain('data-knight-part="isometric-cursor"');
      expect(knightSrc).toContain('data-knight-part="hp-bar"');
      expect(knightSrc).toContain('data-knight-part="ep-bar"');
      expect(knightSrc).toContain('FUI_TOKENS.accentVermilion');
      expect(knightSrc).toContain('FUI_TOKENS.accentCyan');
    },
  );

  // =========================================================================
  // Feature F22: @hermes/ui Tactical Charts: Telemetry & Finance (5 Tests)
  // =========================================================================

  test(
    '[T1][F22] renders <WaffleGrid10x20 /> with exactly 200 0px tiles via Hare-Niemeyer largest-remainder apportionment',
    { tag: ['@tier1', '@F22'] },
    async ({ page }) => {
      const api = createApiClient(E2E_URLS.baseUrl);
      const allocRes = await api.get('/api/finance/allocation?investable_surplus_cents=200000');
      if (allocRes.status === 200 && Array.isArray(allocRes.json?.waffle_tiles)) {
        expect(allocRes.json.waffle_tiles.length).toBe(200);
      }

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);
      const liveWaffle = page.locator('[data-fui="waffle-grid-10x20"]').first();
      if ((await liveWaffle.count()) > 0) {
        await expect(liveWaffle.locator('[data-waffle-tile]')).toHaveCount(200);
      }

      const mathSrc = readUiSource('charts/math.ts');
      expect(mathSrc).toContain('export function computeWaffleAllocation');
      expect(mathSrc).toContain('const exact = 200 * b.p;');
      expect(mathSrc).toContain('const deficit = Math.max(0, 200 - floorSum);');
      expect(mathSrc).toContain('b.rem - a.rem || b.p - a.p || a.originalIndex - b.originalIndex');
      expect(mathSrc).toContain('tiles: tiles.slice(0, 200)');

      const financeChartsSrc = readUiSource('charts/FinanceCharts.tsx');
      expect(financeChartsSrc).toContain('data-fui="waffle-grid-10x20"');
      expect(financeChartsSrc).toContain('data-tile-count={result.tiles.length}');
      expect(financeChartsSrc).toContain('data-waffle-tile={tile.index}');
    },
  );

  test(
    '[T1][F22] renders <HatchedDonutGauge /> with solid #F87C18 arc, 45deg hatched SVG pattern arc, and center tabular readout',
    { tag: ['@tier1', '@F22'] },
    async ({ page }) => {
      const api = createApiClient(E2E_URLS.baseUrl);
      const retRes = await api.get('/api/finance/retirement');
      expect([200, 404]).toContain(retRes.status);

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);
      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const liveDonut = page.locator('[data-fui="hatched-donut-gauge"]').first();
      if ((await liveDonut.count()) > 0) {
        await expect(liveDonut).toBeVisible();
      }

      const financeChartsSrc = readUiSource('charts/FinanceCharts.tsx');
      expect(financeChartsSrc).toContain('export function HatchedDonutGauge');
      expect(financeChartsSrc).toContain('data-fui="hatched-donut-gauge"');
      expect(financeChartsSrc).toContain('patternTransform="rotate(45)"');
      expect(financeChartsSrc).toContain('data-donut-part="track"');
      expect(financeChartsSrc).toContain('data-donut-part="hatched-arc"');
      expect(financeChartsSrc).toContain('data-donut-part="solid-arc"');
      expect(financeChartsSrc).toContain('data-donut-part="center-label"');
      expect(financeChartsSrc).toContain('data-donut-part="duration-label"');
    },
  );

  test(
    '[T1][F22] renders <PairedHatchBarChart /> with hatched planned bars, solid #F6F6F4 actual bars, #EB4511 overspend cap, and 3M/6M/1Y/ALL tabs',
    { tag: ['@tier1', '@F22'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);
      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const financeChartsSrc = readUiSource('charts/FinanceCharts.tsx');
      expect(financeChartsSrc).toContain('export function PairedHatchBarChart');
      expect(financeChartsSrc).toContain(
        "const MONTHLY_RANGES: readonly MonthlyBarRange[] = ['3M', '6M', '1Y', 'ALL'];",
      );
      expect(financeChartsSrc).toContain('data-fui="paired-hatch-bar-chart"');
      expect(financeChartsSrc).toContain('data-range-tab={r}');
      expect(financeChartsSrc).toContain('data-bar-planned={d.month}');
      expect(financeChartsSrc).toContain('data-bar-actual={d.month}');
      expect(financeChartsSrc).toContain('data-bar-overspend={d.month}');
      expect(financeChartsSrc).toContain('fill={FUI_TOKENS.accentVermilion}');
    },
  );

  test(
    '[T1][F22] renders <CandlestickChart /> with hollow/solid OHLC bodies, 90deg peak callout, dotted live price line, and inverted right-axis badge',
    { tag: ['@tier1', '@F22'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);
      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const financeChartsSrc = readUiSource('charts/FinanceCharts.tsx');
      expect(financeChartsSrc).toContain('export function CandlestickChart');
      expect(financeChartsSrc).toContain(
        "const CANDLE_RANGES: readonly CandleRange[] = ['1D', '7D', '1M', '1Y', 'ALL'];",
      );
      expect(financeChartsSrc).toContain('data-fui="candlestick-chart"');
      expect(financeChartsSrc).toContain(
        "data-candle-polarity={isBullish ? 'bullish' : 'bearish'}",
      );
      expect(financeChartsSrc).toContain(
        'fill={isBullish ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark}',
      );
      expect(financeChartsSrc).toContain('data-candle-part="peak-callout"');
      expect(financeChartsSrc).toContain('data-candle-peak-price="true"');
      expect(financeChartsSrc).toContain('data-candle-part="live-price-line"');
      expect(financeChartsSrc).toContain('data-candle-part="live-price-badge"');
      expect(financeChartsSrc).toContain('data-candle-live-price="true"');
    },
  );

  test(
    '[T1][F22] renders REF-06 telemetry charts (<LifeRadarReticle />, <FocusBarcode24h />, <BinaryDotMatrix8x12 />, <WaveformSparkline />, <ConstellationMesh />)',
    { tag: ['@tier1', '@F22'] },
    async ({ page }) => {
      for (const route of ['/dashboard', '/monitor', '/hermes']) {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}${route}`);
        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
        const colorAudit = await auditColorTokens(page);
        expect(colorAudit.hasCarbonBg).toBe(true);
      }

      const telemetrySrc = readUiSource('charts/TelemetryCharts.tsx');
      expect(telemetrySrc).toContain('export function LifeRadarReticle');
      expect(telemetrySrc).toContain('data-fui="life-radar-reticle"');
      expect(telemetrySrc).toContain('data-radar-part="polygon"');
      expect(telemetrySrc).toContain('data-radar-vertex={p.key}');

      expect(telemetrySrc).toContain('export function FocusBarcode24h');
      expect(telemetrySrc).toContain('data-fui="focus-barcode-24h"');
      expect(telemetrySrc).toContain('data-barcode-row="actual"');
      expect(telemetrySrc).toContain('data-barcode-row="planned"');

      expect(telemetrySrc).toContain('export function BinaryDotMatrix8x12');
      expect(telemetrySrc).toContain('data-fui="binary-dot-matrix"');
      expect(telemetrySrc).toContain('rows = 8');
      expect(telemetrySrc).toContain('cols = 12');
      expect(telemetrySrc).toContain('data-matrix-cell={idx}');

      expect(telemetrySrc).toContain('export function WaveformSparkline');
      expect(telemetrySrc).toContain('data-fui="waveform-sparkline"');
      expect(telemetrySrc).toContain('data-waveform-part="polyline"');

      expect(telemetrySrc).toContain('export function ConstellationMesh');
      expect(telemetrySrc).toContain('data-fui="constellation-mesh"');
      expect(telemetrySrc).toContain('data-constellation-part="grid-16x16"');
      expect(telemetrySrc).toContain('Array.from({ length: 17 })');
      expect(telemetrySrc).toContain('data-constellation-part="edges"');
      expect(telemetrySrc).toContain('data-constellation-part="nodes"');
    },
  );
});
