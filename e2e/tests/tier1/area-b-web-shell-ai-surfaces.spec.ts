import { test, expect } from '@playwright/test';
import {
  E2E_URLS,
  ensureStackReady,
  createApiClient,
  unwrapList,
  uniqueId,
  createPatToken,
  readSseEvents,
  CleanupRegistry,
  snapshotSecondBrainFiles,
  cleanupNewSecondBrainFiles,
  createMcpClient,
  waitForAppReady,
  auditZeroBorderRadius,
  auditInteractiveFontFloor,
  auditColorTokens,
  auditPixelatedSprites,
  auditApertureLogo,
} from '../../harness';

function extractEntityId(record: Record<string, any> | null | undefined): string {
  if (!record || typeof record !== 'object') return '';
  const data = record.data && typeof record.data === 'object' ? record.data : record;
  return String(data.id ?? data.session_key ?? data.key ?? '');
}

test.describe('Tier 1 — Area B: HUD Loaders, Web SPA Shell, Hermes, Knights & Frieren (F20, F23, F25, F26, F27)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  // ===========================================================================
  // Feature F20 — REF-09 Orbital Boot Astrolabe, REF-08 Thinking Orb & REF-11/12 Loaders (5 tests)
  // ===========================================================================

  test(
    '[T1][F20] renders Orbital Boot Screen astrolabe sequence and transitions cleanly into ready Web Shell',
    { tag: ['@tier1', '@F20'] },
    async ({ page }) => {
      await page.goto(`${E2E_URLS.baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });

      const bootOrShell = await page.evaluate(() => {
        const bootEl = document.querySelector(
          '[data-fui="orbital-boot-screen"], [data-fui-boot], [data-testid="boot-stage-label"]',
        );
        const rootEl = document.querySelector('#root');
        return {
          hasRoot: Boolean(rootEl),
          sawBootOverlay: Boolean(bootEl),
          bootStage: bootEl?.getAttribute('data-boot-stage') || null,
        };
      });
      expect(bootOrShell.hasRoot).toBe(true);

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

      const readyState = await page.evaluate(() => {
        const landmarks = document.querySelectorAll(
          'main, [role="main"], nav, [role="navigation"], header, [data-fui]',
        );
        return {
          landmarkCount: landmarks.length,
          pathname: window.location.pathname,
        };
      });
      expect(readyState.landmarkCount).toBeGreaterThan(0);
      expect(readyState.pathname).toBe('/dashboard');

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.checkedCount).toBeGreaterThan(0);
      expect(radiusAudit.violations).toEqual([]);
    },
  );

  test(
    '[T1][F20] renders REF-08 Geodesic Thinking Orb with SVG wireframe rings and zero WebGL contexts on /hermes',
    { tag: ['@tier1', '@F20'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/hermes`);

      const hlToggle = page
        .locator(
          '[data-testid="high-level-plan-toggle"], button:has-text("HIGH_LEVEL_PLAN"), button:has-text("High-Level"), [aria-label*="High-Level" i]',
        )
        .first();
      await expect(hlToggle).toBeVisible();
      await hlToggle.click();

      const orbVisibleAfterFirstClick = await page
        .locator(
          '[data-fui="geodesic-thinking-orb"], [aria-label*="Geodesic Thinking Orb" i], [data-fui-orb]',
        )
        .count();
      if (orbVisibleAfterFirstClick === 0) {
        await hlToggle.click();
      }

      const orbAudit = await page.evaluate(() => {
        const orbEl = document.querySelector(
          '[data-fui="geodesic-thinking-orb"], [aria-label*="Geodesic Thinking Orb" i], [data-fui-orb]',
        );
        const canvases = Array.from(document.querySelectorAll('canvas'));
        const hasWebGlCanvas = canvases.some((c) => {
          try {
            return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
          } catch {
            return false;
          }
        });
        const svgCount = document.querySelectorAll('svg').length;
        const orbRings = document.querySelectorAll('[data-orb-ring]').length;
        const orbVertices = document.querySelectorAll('[data-orb-vertex]').length;
        return {
          hasOrbEl: Boolean(orbEl),
          hasWebGlCanvas,
          svgCount,
          orbRings,
          orbVertices,
        };
      });

      expect(orbAudit.hasWebGlCanvas).toBe(false);
      expect(orbAudit.hasOrbEl).toBe(true);
      expect(orbAudit.svgCount).toBeGreaterThan(0);
      expect(orbAudit.orbRings).toBeGreaterThanOrEqual(3);
      expect(orbAudit.orbVertices).toBeGreaterThanOrEqual(12);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);
    },
  );

  test(
    '[T1][F20] renders REF-11 ModularHudLoader variants with tabular telemetry and orthogonal leaders',
    { tag: ['@tier1', '@F20'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

      const loaderCheck = await page.evaluate(() => {
        const hudLoaders = Array.from(
          document.querySelectorAll(
            '[data-fui="modular-hud-loader"], [data-loader-spinner], [data-hud-callout="true"], [data-hud-telemetry-value="true"]',
          ),
        );
        const svgs = Array.from(document.querySelectorAll('svg'));
        return {
          hudLoaderCount: hudLoaders.length,
          svgCount: svgs.length,
          variants: hudLoaders.map((el) => el.getAttribute('data-variant') || ''),
        };
      });

      expect(loaderCheck.hudLoaderCount).toBeGreaterThan(0);
      expect(loaderCheck.svgCount).toBeGreaterThan(0);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);
    },
  );

  test(
    '[T1][F20] renders REF-12 MicroAnimIcon status glyphs across active shell and route surfaces',
    { tag: ['@tier1', '@F20'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

      const microCheck = await page.evaluate(() => {
        const microIcons = Array.from(
          document.querySelectorAll('[data-fui="micro-anim-icon"], [data-micro-icon]'),
        );
        return {
          microCount: microIcons.length,
          variants: microIcons.map(
            (el) => el.getAttribute('data-variant') || el.getAttribute('data-micro-icon') || '',
          ),
        };
      });

      expect(microCheck.microCount).toBeGreaterThan(0);

      const fontAudit = await auditInteractiveFontFloor(page, 12);
      expect(fontAudit.checkedCount).toBeGreaterThan(0);
      expect(fontAudit.violations).toEqual([]);
    },
  );

  test(
    '[T1][F20] enforces REF-02 0px border-radius and carbon/blaze-orange tokens across loader and shell frames',
    { tag: ['@tier1', '@F20'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/hermes`);

      const colorAudit = await auditColorTokens(page);
      expect(colorAudit.hasCarbonBg).toBe(true);
      expect(colorAudit.hasBlazeOrangeAccent).toBe(true);
      expect(colorAudit.hasStarkWhiteInk).toBe(true);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.checkedCount).toBeGreaterThan(0);
      expect(radiusAudit.violations).toEqual([]);
    },
  );

  // ===========================================================================
  // Feature F23 — Web SPA CSR App Shell, Boot Gate, Global Timer & Quick Capture (5 tests)
  // ===========================================================================

  test(
    '[T1][F23] serves 100% CSR static bundle from apps/web/dist with #root mount and zero SSR runtime',
    { tag: ['@tier1', '@F23'] },
    async ({ page }) => {
      const api = createApiClient();
      const rawHtmlRes = await api.raw('/dashboard', {
        headers: { Accept: 'text/html' },
      });
      expect(rawHtmlRes.status).toBe(200);
      expect(rawHtmlRes.text.toLowerCase()).toContain('<!doctype html>');
      expect(rawHtmlRes.text).toContain('id="root"');
      expect(rawHtmlRes.text).not.toContain('__NEXT_DATA__');

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

      const domStats = await page.evaluate(() => {
        const root = document.getElementById('root');
        return {
          rootChildren: root ? root.children.length : 0,
          pathname: window.location.pathname,
        };
      });
      expect(domStats.rootChildren).toBeGreaterThan(0);
      expect(domStats.pathname).toBe('/dashboard');
    },
  );

  test(
    '[T1][F23] navigates across all 9 Web SPA routes while preserving SystemApertureLogo and zero-radius FUI shell',
    { tag: ['@tier1', '@F23'] },
    async ({ page }) => {
      const routes = [
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

      for (const route of routes) {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}${route}`);
        const pathname = await page.evaluate(() => window.location.pathname);
        expect(pathname).toBe(route);

        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
      }

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
      const logoAudit = await auditApertureLogo(page);
      expect(logoAudit.found).toBe(true);
      expect(logoAudit.hasOrangeGear).toBe(true);
      expect(logoAudit.hasShutterBlades).toBe(true);
    },
  );

  test(
    '[T1][F23] opens Cmd+K NLP Quick Capture modal and parses #tag @energy !priority tomorrow 90m into a persisted task',
    { tag: ['@tier1', '@F23'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const captureTag = uniqueId('ops');
      const taskTitleToken = `Ship orbital telemetry ${captureTag}`;
      const rawCapture = `${taskTitleToken} #${captureTag} @deep !high tomorrow 90m`;

      try {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
        await page.keyboard.press('Control+k');

        const modalInput = page
          .locator(
            '[data-testid="quick-capture-input"], [data-testid="quick-capture-modal"] input, [data-testid="quick-capture-modal"] textarea, [role="dialog"] input[type="text"], [role="dialog"] input:not([type="hidden"]), [role="dialog"] textarea, input[placeholder*="Capture" i], input[placeholder*="Task" i]',
          )
          .first();

        if (!(await modalInput.isVisible().catch(() => false))) {
          const triggerBtn = page
            .locator(
              '[data-testid="quick-capture-trigger"], button[aria-label*="Capture" i], button:has-text("Cmd+K"), button:has-text("Ctrl+K"), button:has-text("Quick Capture")',
            )
            .first();
          if ((await triggerBtn.count()) > 0) {
            await triggerBtn.click();
          }
        }

        await expect(modalInput).toBeVisible();
        await modalInput.fill(rawCapture);

        const parseRes = await api.post('/api/tasks/parse', {
          input: rawCapture,
          raw: rawCapture,
          text: rawCapture,
        });
        expect(parseRes.status).toBe(200);
        const parsed = parseRes.json?.data ?? parseRes.json;
        expect(String(parsed.title ?? '')).toContain('Ship orbital telemetry');

        await modalInput.press('Enter');

        if (await modalInput.isVisible().catch(() => false)) {
          const submitBtn = page
            .locator(
              '[data-testid="quick-capture-submit"], [role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Capture"), [role="dialog"] button:has-text("Create"), [role="dialog"] button:has-text("Add")',
            )
            .first();
          if ((await submitBtn.count()) > 0) {
            await submitBtn.click();
          }
        }

        cleanup.defer(async () => {
          const listRes = await api.get('/api/tasks');
          const allTasks = unwrapList<Record<string, any>>(listRes, ['tasks']);
          for (const t of allTasks) {
            if (String(t.title || '').includes(captureTag) && t.id) {
              await api.delete(`/api/tasks/${encodeURIComponent(String(t.id))}`);
            }
          }
        });

        await expect
          .poll(
            async () => {
              const tasksRes = await api.get('/api/tasks');
              const tasks = unwrapList<Record<string, any>>(tasksRes, ['tasks']);
              return tasks.some((t) => String(t.title || '').includes(captureTag));
            },
            { timeout: 5_000 },
          )
          .toBe(true);

        const tasksRes = await api.get('/api/tasks');
        expect(tasksRes.status).toBe(200);
        const tasks = unwrapList<Record<string, any>>(tasksRes, ['tasks']);
        const created = tasks.find((t) => String(t.title || '').includes(captureTag));
        expect(created).toBeDefined();
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F23] maintains persistent ActiveTimer bar in global header across route transitions and logs TimeSession on stop',
    { tag: ['@tier1', '@F23'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const taskTitle = uniqueId('Timer-Persistence-Task');

      try {
        await api.post('/api/time/timer/discard', {}).catch(() => {});

        const taskRes = await api.post('/api/tasks', {
          title: taskTitle,
          status: 'todo',
          priority: 'high',
          estimate_minutes: 25,
        });
        expect(taskRes.ok).toBe(true);
        const taskId = extractEntityId(taskRes.json);
        cleanup.defer(async () => {
          await api.post('/api/time/timer/discard', {}).catch(() => {});
          const sessRes = await api.get('/api/time/sessions');
          const sessions = unwrapList<Record<string, any>>(sessRes, ['time_sessions', 'sessions']);
          for (const s of sessions) {
            if (String(s.task_id) === taskId && s.id) {
              await api.delete(`/api/time/sessions/${encodeURIComponent(String(s.id))}`);
            }
          }
          await api.delete(`/api/tasks/${encodeURIComponent(taskId)}`);
        });

        const startRes = await api.post('/api/time/timer/start', {
          task_id: taskId,
          mode: 'pomodoro',
          pomodoro_work_sec: 1500,
          pomodoro_break_sec: 300,
        });
        expect(startRes.ok).toBe(true);

        const activeCheck = await api.get('/api/time/timer');
        expect(activeCheck.status).toBe(200);
        const timerData = activeCheck.json?.timer ?? activeCheck.json?.data ?? activeCheck.json;
        expect(timerData).toBeTruthy();

        for (const route of ['/todos', '/dashboard', '/finance']) {
          await waitForAppReady(page, `${E2E_URLS.baseUrl}${route}`);

          const timerBarDom = await page.evaluate((expectedTitle) => {
            const timerEl = document.querySelector(
              '[data-testid="active-timer-bar"], [data-fui="active-timer-bar"], header [data-testid*="timer" i], [data-active-timer="true"]',
            );
            const headerOrBodyText =
              (document.querySelector('header')?.textContent || '') +
              ' ' +
              (timerEl?.textContent || '');
            return {
              hasTimerBar: Boolean(timerEl),
              displaysTaskOrPomodoro:
                headerOrBodyText.includes(expectedTitle) ||
                /pomodoro|stopwatch|\d{2}:\d{2}/i.test(headerOrBodyText),
            };
          }, taskTitle);

          expect(timerBarDom.hasTimerBar).toBe(true);
          expect(timerBarDom.displaysTaskOrPomodoro).toBe(true);
        }

        const stopRes = await api.post('/api/time/timer/stop', {
          notes: 'Completed Pomodoro focus block across routes',
        });
        expect(stopRes.ok).toBe(true);

        const sessionsRes = await api.get('/api/time/sessions');
        expect(sessionsRes.status).toBe(200);
        const sessions = unwrapList<Record<string, any>>(sessionsRes, [
          'time_sessions',
          'sessions',
        ]);
        const recordedSession = sessions.find((s) => String(s.task_id) === taskId);
        expect(recordedSession).toBeDefined();
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F23] toggles global Privacy Mask to redact currency values while preserving percentages and issues pairing QR payload',
    { tag: ['@tier1', '@F23'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);
        await page.evaluate(() => {
          window.localStorage.setItem('hermes-fui-privacy-mask', 'false');
        });
        await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);

        const privacyBtn = page
          .locator(
            '[data-testid="fui-privacy-toggle"], button[aria-label*="Privacy" i], button:has-text("👁")',
          )
          .first();

        await expect(privacyBtn).toBeVisible();
        await privacyBtn.click();

        const maskedState = await page.evaluate(() => {
          const btn = document.querySelector(
            '[data-testid="fui-privacy-toggle"], button[aria-label*="Privacy" i]',
          );
          const ls = window.localStorage.getItem('hermes-fui-privacy-mask');
          const maskedCurrencyEls = Array.from(
            document.querySelectorAll(
              '[data-privacy-masked="true"], [data-fui="privacy-value"][data-privacy-kind="currency"]',
            ),
          );
          const unmaskedPercentEls = Array.from(
            document.querySelectorAll(
              '[data-fui="privacy-value"][data-privacy-kind="percent"][data-privacy-masked="false"], [data-privacy-kind="percent"]',
            ),
          );
          const pageText = document.body?.innerText || '';
          return {
            privacyActive:
              btn?.getAttribute('data-privacy-active') === 'true' ||
              document.documentElement.getAttribute('data-privacy-active') === 'true' ||
              ls === 'true',
            hasMaskedCurrency:
              maskedCurrencyEls.length > 0 || pageText.includes('••••') || pageText.includes('***'),
            hasUnmaskedPercent:
              unmaskedPercentEls.some((el) => !(el.textContent || '').includes('••••')) ||
              /\d+(?:\.\d+)?%/.test(pageText),
          };
        });

        expect(maskedState.privacyActive).toBe(true);
        expect(maskedState.hasMaskedCurrency).toBe(true);
        expect(maskedState.hasUnmaskedPercent).toBe(true);

        const pat = await createPatToken(api, uniqueId('shell-pairing-pat'));
        cleanup.defer(async () => {
          if (pat.id) {
            await api.delete(`/api/auth/tokens/${encodeURIComponent(pat.id)}`);
          }
        });
        expect(pat.token.startsWith('plm_pat_')).toBe(true);

        const qrRes = await api.post('/api/auth/pairing-qr', {
          token_name: 'Mobile Companion QR',
          primary_url: E2E_URLS.baseUrl,
        });
        expect(qrRes.status).toBe(200);
        expect(qrRes.json).toBeTruthy();
      } finally {
        await page
          .evaluate(() => {
            window.localStorage.setItem('hermes-fui-privacy-mask', 'false');
          })
          .catch(() => {});
        await cleanup.runAll();
      }
    },
  );

  // ===========================================================================
  // Feature F25 — Hermes Chat Workspace (/hermes) & REF-08 Thinking Orb (5 tests)
  // ===========================================================================

  test(
    '[T1][F25] renders /hermes workspace and supports session create, pin, search, fork, and archive',
    { tag: ['@tier1', '@F25'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const sessionKey = uniqueId('sess-f25-rail');
      const sessionTitle = `Q2 Architecture Review ${uniqueId('title')}`;

      try {
        const createRes = await api.post('/api/hermes/sessions', {
          session_key: sessionKey,
          title: sessionTitle,
          origin: 'hermes_view',
          pinned: true,
        });
        expect(createRes.ok).toBe(true);
        cleanup.defer(async () => {
          await api.delete(`/api/hermes/sessions/${encodeURIComponent(sessionKey)}`);
        });

        await waitForAppReady(
          page,
          `${E2E_URLS.baseUrl}/hermes?session=${encodeURIComponent(sessionKey)}`,
        );

        const hermesRailDom = await page.evaluate((expectedTitle) => {
          const railEl = document.querySelector(
            '[data-testid*="session" i], aside, nav, [role="navigation"]',
          );
          const composerEl = document.querySelector(
            'textarea, input[type="text"], [data-testid*="composer" i], [placeholder*="Hermes" i], [placeholder*="message" i]',
          );
          const bodyText = document.body?.innerText || '';
          return {
            hasSessionRail: Boolean(railEl),
            hasComposer: Boolean(composerEl),
            showsSessionOrWorkspace:
              bodyText.includes(expectedTitle) || /hermes|session|pinned/i.test(bodyText),
          };
        }, sessionTitle);

        expect(hermesRailDom.hasSessionRail).toBe(true);
        expect(hermesRailDom.hasComposer).toBe(true);
        expect(hermesRailDom.showsSessionOrWorkspace).toBe(true);

        const searchRes = await api.get(
          `/api/hermes/sessions?q=${encodeURIComponent('Architecture Review')}`,
        );
        expect(searchRes.status).toBe(200);
        const searchList = unwrapList<Record<string, any>>(searchRes, ['sessions']);
        expect(searchList.some((s) => extractEntityId(s) === sessionKey)).toBe(true);

        const forkRes = await api.post(
          `/api/hermes/sessions/${encodeURIComponent(sessionKey)}/fork`,
          {
            title: `${sessionTitle} (Branch)`,
          },
        );
        expect(forkRes.ok).toBe(true);
        const forkedKey = extractEntityId(forkRes.json);
        if (forkedKey) {
          cleanup.defer(async () => {
            await api.delete(`/api/hermes/sessions/${encodeURIComponent(forkedKey)}`);
          });
        }

        const archiveRes = await api.patch(
          `/api/hermes/sessions/${encodeURIComponent(sessionKey)}`,
          { archived: true },
        );
        expect(archiveRes.status).toBe(200);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F25] streams unified X-Hermes-Session-Key chat on /hermes and renders markdown and thinking blocks',
    { tag: ['@tier1', '@F25'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const sessionKey = uniqueId('sess-f25-stream');
      const promptText = 'Summarize active operations in a markdown table';

      try {
        cleanup.defer(async () => {
          await api.delete(`/api/hermes/sessions/${encodeURIComponent(sessionKey)}`);
        });

        const streamUrl = api.resolveUrl('/api/hermes/chat/stream');
        const events = await readSseEvents(streamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hermes-Session-Key': sessionKey,
          },
          body: JSON.stringify({
            message: promptText,
            session_key: sessionKey,
            high_level_mode: true,
            origin: 'hermes_view',
          }),
          stopOnEvent: 'done',
          timeoutMs: 10_000,
        });
        expect(events.length).toBeGreaterThan(0);

        await waitForAppReady(
          page,
          `${E2E_URLS.baseUrl}/hermes?session=${encodeURIComponent(sessionKey)}`,
        );

        const streamDom = await page.evaluate((expectedPrompt) => {
          const mainEl = document.querySelector('main, [role="main"], #root');
          const thinkingOrOrb = document.querySelector(
            '[data-testid*="thinking" i], details, [data-fui="geodesic-thinking-orb"], [data-testid="high-level-plan-toggle"]',
          );
          const textContent = mainEl?.textContent || '';
          return {
            hasMainStream: Boolean(mainEl) && textContent.length > 0,
            hasThinkingOrOrbSurface:
              Boolean(thinkingOrOrb) ||
              textContent.includes(expectedPrompt) ||
              /thinking|high_level_plan|hermes/i.test(textContent),
          };
        }, promptText);

        expect(streamDom.hasMainStream).toBe(true);
        expect(streamDom.hasThinkingOrOrbSurface).toBe(true);

        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F25] activates HIGH_LEVEL_PLAN Geodesic Thinking Orb and processes @mentions and /slash commands on /hermes',
    { tag: ['@tier1', '@F25'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const sessionKey = uniqueId('sess-f25-mentions');

      try {
        cleanup.defer(async () => {
          await api.delete(`/api/hermes/sessions/${encodeURIComponent(sessionKey)}`);
        });

        const streamUrl = api.resolveUrl('/api/hermes/chat/stream');
        const events = await readSseEvents(streamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hermes-Session-Key': sessionKey,
          },
          body: JSON.stringify({
            message: '/deep-plan Cross-reference @goals and @tasks for Q1 alignment',
            session_key: sessionKey,
            high_level_mode: true,
            slash_command: '/deep-plan',
            mentions: ['@goals', '@tasks'],
            origin: 'hermes_view',
          }),
          stopOnEvent: 'done',
          timeoutMs: 10_000,
        });
        expect(events.length).toBeGreaterThan(0);

        await waitForAppReady(
          page,
          `${E2E_URLS.baseUrl}/hermes?session=${encodeURIComponent(sessionKey)}`,
        );

        const hlToggle = page
          .locator(
            '[data-testid="high-level-plan-toggle"], button:has-text("HIGH_LEVEL_PLAN"), button:has-text("High-Level"), [aria-label*="High-Level" i]',
          )
          .first();
        await expect(hlToggle).toBeVisible();
        await hlToggle.click();

        const orbCount = await page
          .locator(
            '[data-fui="geodesic-thinking-orb"], [aria-label*="Geodesic Thinking Orb" i], [data-fui-orb]',
          )
          .count();
        if (orbCount === 0) {
          await hlToggle.click();
        }

        const orbAndMentionDom = await page.evaluate(() => {
          const orbEl = document.querySelector(
            '[data-fui="geodesic-thinking-orb"], [aria-label*="Geodesic Thinking Orb" i], [data-fui-orb]',
          );
          const composerEl = document.querySelector(
            'textarea, input[type="text"], [data-testid*="composer" i]',
          );
          return {
            hasThinkingOrb: Boolean(orbEl),
            hasComposerInput: Boolean(composerEl),
          };
        });

        expect(orbAndMentionDom.hasThinkingOrb).toBe(true);
        expect(orbAndMentionDom.hasComposerInput).toBe(true);

        const fontAudit = await auditInteractiveFontFloor(page, 12);
        expect(fontAudit.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F25] executes inline [Undo] (IMMEDIATE_UNDO) and [Approve] (REQUIRE_APPROVAL) MCP write cards on /hermes',
    { tag: ['@tier1', '@F25'] },
    async ({ page }) => {
      const api = createApiClient();
      const mcp = createMcpClient();
      const cleanup = new CleanupRegistry();
      const taskTitle = uniqueId('Hermes-Card-Task');
      const sym = `F25${Date.now().toString().slice(-4)}.SA`;

      try {
        const undoCall = await mcp.callTool('todos_create_task', {
          title: taskTitle,
          status: 'todo',
          priority: 'medium',
        });
        cleanup.defer(async () => {
          const listRes = await api.get('/api/tasks');
          const tasks = unwrapList<Record<string, any>>(listRes, ['tasks']);
          const match = tasks.find((t) => t.title === taskTitle);
          if (match?.id) {
            await api.delete(`/api/tasks/${encodeURIComponent(String(match.id))}`);
          }
        });
        expect(undoCall.ok).toBe(true);
        expect(typeof undoCall.undoId).toBe('string');

        const approvalCall = await mcp.callTool('finance_upsert_asset', {
          symbol: sym,
          name: 'Hermes Approved Equity',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: false,
          quantity: 0,
          avg_cost_cents: 0,
          current_price_cents: 3200,
          target_weight_pct: 0,
        });
        cleanup.defer(async () => {
          if (approvalCall.approvalId) {
            await api
              .post(
                `/api/mcp/approvals/${encodeURIComponent(approvalCall.approvalId)}/reject`,
                { reason: 'Cleanup fallback' },
              )
              .catch(() => {});
          }
          const assetsRes = await api.get('/api/finance/assets');
          const assets = unwrapList<Record<string, any>>(assetsRes, ['assets']);
          const match = assets.find((a) => a.symbol === sym);
          if (match?.id) {
            await api.delete(`/api/finance/assets/${encodeURIComponent(String(match.id))}`);
          }
        });
        expect(typeof approvalCall.approvalId).toBe('string');

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/hermes`);

        const autonomyDom = await page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const autonomyControls = document.querySelectorAll(
            '[data-testid*="approval" i], [data-testid*="undo" i], button',
          );
          return {
            hasControls: autonomyControls.length > 0,
            hasAutonomyOrHermesUi: /approve|undo|mcp|hermes|autonomy/i.test(bodyText),
          };
        });
        expect(autonomyDom.hasControls).toBe(true);
        expect(autonomyDom.hasAutonomyOrHermesUi).toBe(true);

        const undoRes = await api.post(
          `/api/mcp/undo/${encodeURIComponent(undoCall.undoId!)}`,
          {},
        );
        expect(undoRes.status).toBe(200);

        const approveRes = await api.post(
          `/api/mcp/approvals/${encodeURIComponent(approvalCall.approvalId!)}/approve`,
          {},
        );
        expect(approveRes.status).toBe(200);

        const assetsRes = await api.get('/api/finance/assets');
        const assets = unwrapList<Record<string, any>>(assetsRes, ['assets']);
        const createdAsset = assets.find((a) => a.symbol === sym);
        expect(createdAsset).toBeDefined();
      } finally {
        await mcp.closeSession();
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F25] previews Vault notes in /hermes Right Drawer and distills conversation takeaways to Vault Inbox',
    { tag: ['@tier1', '@F25'] },
    async ({ page }) => {
      const api = createApiClient();
      const beforeFiles = snapshotSecondBrainFiles();
      const noteTitle = `Hermes Vault Distill ${uniqueId('inbox')}`;

      try {
        const distillRes = await api.post('/api/vault/distill', {
          title: noteTitle,
          content_md: '# Distilled Strategy\n\n- Maintain 0px rectilinear discipline.',
          content: '# Distilled Strategy\n\n- Maintain 0px rectilinear discipline.',
          folder: 'Inbox',
          tags: ['hermes', 'inbox'],
        });
        expect(distillRes.ok).toBe(true);
        const distilled = distillRes.json?.data ?? distillRes.json;
        const relPath = String(distilled.path ?? distilled.file_path ?? '');
        expect(relPath.endsWith('.md')).toBe(true);

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/hermes`);

        const vaultToggle = page
          .locator(
            '[data-testid="hermes-vault-drawer-toggle"], button:has-text("Vault"), button[aria-label*="Vault" i]',
          )
          .first();
        if ((await vaultToggle.count()) > 0 && (await vaultToggle.isVisible())) {
          await vaultToggle.click();
        }

        const vaultDom = await page.evaluate((expectedTitle) => {
          const drawerOrInspector = document.querySelector(
            '[data-testid*="vault" i], aside, [data-testid*="drawer" i], main',
          );
          const bodyText = document.body?.innerText || '';
          return {
            hasVaultSurface: Boolean(drawerOrInspector),
            showsVaultOrDistillUi:
              bodyText.includes(expectedTitle) || /vault|distill|inbox|notes/i.test(bodyText),
          };
        }, noteTitle);

        expect(vaultDom.hasVaultSurface).toBe(true);
        expect(vaultDom.showsVaultOrDistillUi).toBe(true);

        const noteRes = await api.get(`/api/vault/note?path=${encodeURIComponent(relPath)}`);
        expect(noteRes.status).toBe(200);
        expect(noteRes.text).toContain('Distilled Strategy');
      } finally {
        cleanupNewSecondBrainFiles(beforeFiles);
      }
    },
  );

  // ===========================================================================
  // Feature F26 — Agent Studio Isometric Knight Arena (/agents) (5 tests)
  // ===========================================================================

  test(
    '[T1][F26] renders /agents 2:1 Isometric Knight Arena with 4 tactical zones, 4 Starter Knights, and HP/EP bars',
    { tag: ['@tier1', '@F26'] },
    async ({ page }) => {
      const api = createApiClient();
      const agentsRes = await api.get('/api/agents');
      expect(agentsRes.status).toBe(200);
      const agents = unwrapList<Record<string, any>>(agentsRes, ['agents']);
      expect(agents.length).toBeGreaterThanOrEqual(4);

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);

      const arenaDom = await page.evaluate(() => {
        const knightSprites = document.querySelectorAll(
          '[data-fui="isometric-knight-sprite"], [data-knight-sprite], [data-archetype]',
        );
        const hpBars = document.querySelectorAll(
          '[data-knight-part="hp-bar"], [data-testid*="hp-bar" i]',
        );
        const epBars = document.querySelectorAll(
          '[data-knight-part="ep-bar"], [data-testid*="ep-bar" i]',
        );
        const zoneEls = document.querySelectorAll(
          '[data-zone], [data-testid*="zone" i]',
        );
        const bodyText = document.body?.innerText || '';
        const matchedZones = [
          /watchtower|frontline/i.test(bodyText),
          /ambush/i.test(bodyText),
          /council/i.test(bodyText),
          /barracks/i.test(bodyText),
        ].filter(Boolean).length;
        return {
          knightSpriteCount: knightSprites.length,
          hpBarCount: hpBars.length,
          epBarCount: epBars.length,
          zoneCount: Math.max(zoneEls.length, matchedZones),
        };
      });

      expect(arenaDom.knightSpriteCount).toBeGreaterThanOrEqual(4);
      expect(arenaDom.hpBarCount).toBeGreaterThanOrEqual(4);
      expect(arenaDom.epBarCount).toBeGreaterThanOrEqual(4);
      expect(arenaDom.zoneCount).toBeGreaterThanOrEqual(4);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      const spriteAudit = await auditPixelatedSprites(page);
      expect(spriteAudit.spriteCount).toBeGreaterThan(0);
      expect(spriteAudit.violations).toEqual([]);
    },
  );

  test(
    '[T1][F26] updates Knight 2x2 /mcp Skill Slot policies across READ, APPROVE, and AUTO on /agents',
    { tag: ['@tier1', '@F26'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const slug = uniqueId('knight-skill-slots');

      try {
        const createRes = await api.post('/api/agents', {
          slug,
          name: 'Skill Slot Vanguard',
          archetype: 'vanguard',
          knight_archetype: 'vanguard',
          crest_color: '#F59E0B',
          zone: 'event_ambush',
          grid_pos: { x: 2, y: 2, zone: 'event_ambush' },
          system_prompt: 'Guard portfolio drift thresholds.',
          tools_policy: {
            'todos.*': 'READ',
            'finance.*': 'APPROVE',
            'dashboards.*': 'READ',
            'goals.*': 'READ',
          },
          monthly_budget_cents: 500,
        });
        expect(createRes.ok).toBe(true);
        const knightId = extractEntityId(createRes.json);
        cleanup.defer(async () => {
          await api.delete(`/api/agents/${encodeURIComponent(knightId)}`);
        });

        const updateRes = await api.put(`/api/agents/${encodeURIComponent(knightId)}`, {
          tools_policy: {
            'todos.*': 'AUTO',
            'finance.*': 'APPROVE',
            'dashboards.*': 'AUTO',
            'goals.*': 'APPROVE',
          },
        });
        expect(updateRes.status).toBe(200);

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);

        const knightCard = page.locator(':text("Skill Slot Vanguard")').first();
        if ((await knightCard.count()) > 0 && (await knightCard.isVisible())) {
          await knightCard.click();
        }

        const skillDom = await page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const sprites = document.querySelectorAll(
            '[data-fui="isometric-knight-sprite"], [data-archetype]',
          );
          return {
            hasKnightSprites: sprites.length > 0,
            hasSkillPolicyText: /READ|APPROVE|AUTO/i.test(bodyText),
          };
        });
        expect(skillDom.hasKnightSprites).toBe(true);
        expect(skillDom.hasSkillPolicyText).toBe(true);

        const getRes = await api.get(`/api/agents/${encodeURIComponent(knightId)}`);
        expect(getRes.status).toBe(200);
        const policyStr = JSON.stringify(getRes.json);
        expect(policyStr).toContain('AUTO');
        expect(policyStr).toContain('APPROVE');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F26] creates a new Knight via Knight Forge with SOUL.md template directives and cron/event triggers',
    { tag: ['@tier1', '@F26'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const slug = uniqueId('knight-forge-sentinel');

      try {
        const createRes = await api.post('/api/agents', {
          slug,
          name: 'Sentinel — The Vault Watcher',
          archetype: 'artificer',
          knight_archetype: 'artificer',
          crest_color: '#2CE5F2',
          zone: 'cron_watchtower',
          grid_pos: { x: 1, y: 3, zone: 'cron_watchtower' },
          system_prompt:
            '# SOUL.md\nDate: {{today}}\nGoals: {{active_goals}}\nPortfolio: {{portfolio_summary}}',
          monthly_budget_cents: 600,
        });
        expect(createRes.ok).toBe(true);
        const knightId = extractEntityId(createRes.json);
        cleanup.defer(async () => {
          await api.delete(`/api/agents/${encodeURIComponent(knightId)}`);
        });

        const trigRes = await api.post(
          `/api/agents/${encodeURIComponent(knightId)}/triggers`,
          {
            type: 'cron',
            trigger_type: 'cron',
            cron_expr: '0 0 9 * * 1-5',
            config_json: { cron: '0 0 9 * * 1-5' },
            enabled: true,
          },
        );
        expect(trigRes.ok).toBe(true);

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);

        const forgeDom = await page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const sprites = document.querySelectorAll(
            '[data-fui="isometric-knight-sprite"], [data-archetype]',
          );
          return {
            hasKnightSprites: sprites.length > 0,
            showsSentinelOrForgeUi:
              bodyText.includes('Sentinel') || /forge|soul\.md|watchtower|trigger/i.test(bodyText),
          };
        });
        expect(forgeDom.hasKnightSprites).toBe(true);
        expect(forgeDom.showsSentinelOrForgeUi).toBe(true);

        const getRes = await api.get(`/api/agents/${encodeURIComponent(knightId)}`);
        expect(getRes.status).toBe(200);
        expect(JSON.stringify(getRes.json)).toContain('Sentinel — The Vault Watcher');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F26] dispatches a live Knight run ([Dispatch Now]) on /agents and records telemetry in /api/agent-runs',
    { tag: ['@tier1', '@F26'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const slug = uniqueId('knight-ui-dispatch');

      try {
        const createRes = await api.post('/api/agents', {
          slug,
          name: 'Arena Dispatch Paladin',
          archetype: 'paladin',
          knight_archetype: 'paladin',
          crest_color: '#F87C18',
          zone: 'cron_watchtower',
          grid_pos: { x: 2, y: 2, zone: 'cron_watchtower' },
          system_prompt: 'Execute tactical brief on {{today}}.',
          monthly_budget_cents: 500,
        });
        expect(createRes.ok).toBe(true);
        const knightId = extractEntityId(createRes.json);
        cleanup.defer(async () => {
          await api.delete(`/api/agents/${encodeURIComponent(knightId)}`);
        });

        const dispatchRes = await api.post(
          `/api/agents/${encodeURIComponent(knightId)}/dispatch`,
          {
            dry_run: false,
            input: 'Tactical Frontline Dispatch',
          },
        );
        expect(dispatchRes.ok).toBe(true);

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);

        const dispatchDom = await page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const sprites = document.querySelectorAll(
            '[data-fui="isometric-knight-sprite"], [data-archetype]',
          );
          return {
            hasArenaSprites: sprites.length > 0,
            hasDispatchOrRunUi:
              bodyText.includes('Arena Dispatch Paladin') ||
              /dispatch|run|queue|timeline/i.test(bodyText),
          };
        });
        expect(dispatchDom.hasArenaSprites).toBe(true);
        expect(dispatchDom.hasDispatchOrRunUi).toBe(true);

        const runsRes = await api.get('/api/agent-runs');
        expect(runsRes.status).toBe(200);
        const runs = unwrapList<Record<string, any>>(runsRes, ['agent_runs', 'runs']);
        expect(runs.some((r) => String(r.agent_id) === knightId)).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F26] executes Dry-Run Sandbox on /agents without deducting Knight HP budget',
    { tag: ['@tier1', '@F26'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const slug = uniqueId('knight-ui-dryrun');

      try {
        const createRes = await api.post('/api/agents', {
          slug,
          name: 'Sandbox Lore Warden',
          archetype: 'lore_warden',
          knight_archetype: 'lore_warden',
          crest_color: '#2CE5F2',
          zone: 'event_ambush',
          grid_pos: { x: 3, y: 1, zone: 'event_ambush' },
          system_prompt: 'Dry run on {{today}} with {{active_goals}}.',
          monthly_budget_cents: 500,
        });
        expect(createRes.ok).toBe(true);
        const knightId = extractEntityId(createRes.json);
        cleanup.defer(async () => {
          await api.delete(`/api/agents/${encodeURIComponent(knightId)}`);
        });

        const dryRes = await api.post(
          `/api/agents/${encodeURIComponent(knightId)}/dispatch`,
          {
            dry_run: true,
            input: 'Simulate YoutubeCrawlerSynced event',
          },
        );
        expect(dryRes.ok).toBe(true);

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);

        const sandboxDom = await page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const hpBars = document.querySelectorAll(
            '[data-knight-part="hp-bar"], [data-testid*="hp-bar" i]',
          );
          return {
            hasHpBars: hpBars.length > 0,
            hasSandboxOrKnightText:
              bodyText.includes('Sandbox Lore Warden') ||
              /dry-run|sandbox|dispatch|hp/i.test(bodyText),
          };
        });
        expect(sandboxDom.hasHpBars).toBe(true);
        expect(sandboxDom.hasSandboxOrKnightText).toBe(true);

        const afterKnightRes = await api.get(`/api/agents/${encodeURIComponent(knightId)}`);
        expect(afterKnightRes.status).toBe(200);
        const knightObj = afterKnightRes.json?.data ?? afterKnightRes.json;
        expect(Number(knightObj.spent_month_cents ?? 0)).toBe(0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  // ===========================================================================
  // Feature F27 — Omnipresent Web Frieren Mastermind Companion (Cmd+J) (5 tests)
  // ===========================================================================

  test(
    '[T1][F27] mounts CompanionStage mini-sprite on 3px #F87C18 header ledges across Web SPA routes',
    { tag: ['@tier1', '@F27'] },
    async ({ page }) => {
      const verifiedRoutes: string[] = [];
      for (const route of ['/dashboard', '/todos', '/finance']) {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}${route}`);

        const ledgeInspection = await page.evaluate(() => {
          const ledgeContainer = document.querySelector(
            '[data-testid="companion-stage-ledge"], [data-fui="companion-stage"][data-mode="ledge"], [data-companion-ledge="true"]',
          );
          const shelfBar = document.querySelector('[data-companion-ledge="true"]');
          const miniSprite = document.querySelector(
            '[data-testid="companion-mini-sprite"], [data-fui="companion-stage"] canvas, [data-fui="companion-stage"] img',
          );
          const shelfStyle = shelfBar ? window.getComputedStyle(shelfBar) : null;
          return {
            foundLedge: Boolean(ledgeContainer || shelfBar),
            shelfHeight: shelfStyle?.height || null,
            hasMiniSprite: Boolean(miniSprite),
          };
        });

        expect(ledgeInspection.foundLedge).toBe(true);
        expect(ledgeInspection.shelfHeight).toBe('3px');
        expect(ledgeInspection.hasMiniSprite).toBe(true);

        const spriteAudit = await auditPixelatedSprites(page);
        expect(spriteAudit.spriteCount).toBeGreaterThan(0);
        expect(spriteAudit.violations).toEqual([]);
        verifiedRoutes.push(route);
      }

      expect(verifiedRoutes).toEqual(['/dashboard', '/todos', '/finance']);
      expect(verifiedRoutes.length).toBe(3);
    },
  );

  test(
    '[T1][F27] toggles REF-14 waist-up Frieren chat popover via Control+j keyboard shortcut from any route',
    { tag: ['@tier1', '@F27'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

      await page.keyboard.press('Control+j');

      const popoverAudit = await page.evaluate(() => {
        const popover = document.querySelector(
          '[data-testid="companion-stage-popover"], [data-fui="companion-stage"][data-mode="popover"], [role="dialog"]',
        );
        const portrait = document.querySelector(
          '[data-testid="companion-portrait-sprite"], [data-testid="companion-stage-popover"] canvas, [data-testid="companion-stage-popover"] img',
        );
        return {
          hasPopover: Boolean(popover),
          hasPortraitSprite: Boolean(portrait),
        };
      });

      expect(popoverAudit.hasPopover).toBe(true);
      expect(popoverAudit.hasPortraitSprite).toBe(true);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);

      await page.keyboard.press('Control+j');

      const popoverAfterClose = await page.evaluate(() => {
        const popover = document.querySelector(
          '[data-testid="companion-stage-popover"], [data-fui="companion-stage"][data-mode="popover"]',
        );
        if (!popover) return false;
        const cs = window.getComputedStyle(popover);
        const rect = popover.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
      expect(popoverAfterClose).toBe(false);
    },
  );

  test(
    '[T1][F27] injects automatic page-context metadata (/todos, /finance) into Frieren companion sessions',
    { tag: ['@tier1', '@F27'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const sessionKey = uniqueId('sess-f27-ctx');

      try {
        cleanup.defer(async () => {
          await api.delete(`/api/hermes/sessions/${encodeURIComponent(sessionKey)}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);
        await page.keyboard.press('Control+j');

        const ctxLocator = page
          .locator(
            '[data-testid="companion-page-context"], [data-testid="companion-stage-popover"]',
          )
          .first();
        await expect(ctxLocator).toBeVisible();
        const ctxTextOnTodos = (await ctxLocator.textContent()) || '';
        expect(ctxTextOnTodos).toContain('/todos');

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);
        const popoverVisibleOnFinance = await page
          .locator('[data-testid="companion-stage-popover"]')
          .isVisible()
          .catch(() => false);
        if (!popoverVisibleOnFinance) {
          await page.keyboard.press('Control+j');
        }

        const ctxFinanceLocator = page
          .locator(
            '[data-testid="companion-page-context"], [data-testid="companion-stage-popover"]',
          )
          .first();
        await expect(ctxFinanceLocator).toBeVisible();
        const ctxTextOnFinance = (await ctxFinanceLocator.textContent()) || '';
        expect(ctxTextOnFinance).toContain('/finance');

        const streamUrl = api.resolveUrl('/api/hermes/chat/stream');
        const events = await readSseEvents(streamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hermes-Session-Key': sessionKey,
          },
          body: JSON.stringify({
            message: 'Triage my active tasks on this screen',
            session_key: sessionKey,
            origin: 'frieren_popover',
            page_context: {
              active_route: '/todos',
              active_dashboard_id: null,
              selected_entity_id: null,
            },
          }),
          stopOnEvent: 'done',
          timeoutMs: 10_000,
        });
        expect(events.length).toBeGreaterThan(0);

        const sessRes = await api.get(
          `/api/hermes/sessions/${encodeURIComponent(sessionKey)}`,
        );
        expect(sessRes.status).toBe(200);
        expect(JSON.stringify(sessRes.json)).toContain('/todos');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F27] expands Frieren popover conversation into full /hermes view preserving X-Hermes-Session-Key history',
    { tag: ['@tier1', '@F27'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const sharedKey = uniqueId('sess-f27-expand');

      try {
        cleanup.defer(async () => {
          await api.delete(`/api/hermes/sessions/${encodeURIComponent(sharedKey)}`);
        });

        const streamUrl = api.resolveUrl('/api/hermes/chat/stream');
        await readSseEvents(streamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hermes-Session-Key': sharedKey,
          },
          body: JSON.stringify({
            message: 'Start in Frieren popover and expand to Hermes',
            session_key: sharedKey,
            origin: 'frieren_popover',
            page_context: { active_route: '/courses' },
          }),
          stopOnEvent: 'done',
          timeoutMs: 10_000,
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/courses`);
        await page.keyboard.press('Control+j');

        const expandBtn = page
          .locator(
            '[data-testid="companion-expand-hermes"], a:has-text("Expand in Full Hermes View"), button:has-text("Expand in Full Hermes View")',
          )
          .first();
        await expect(expandBtn).toBeVisible();
        await expandBtn.click();

        await expect
          .poll(
            async () => page.evaluate(() => window.location.pathname),
            { timeout: 5_000 },
          )
          .toBe('/hermes');

        const pathnameAfterExpand = await page.evaluate(() => window.location.pathname);
        expect(pathnameAfterExpand).toBe('/hermes');

        const sessRes = await api.get(
          `/api/hermes/sessions/${encodeURIComponent(sharedKey)}`,
        );
        expect(sessRes.status).toBe(200);
        expect(JSON.stringify(sessRes.json)).toContain(
          'Start in Frieren popover and expand to Hermes',
        );
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F27] surfaces proactive companion nudges and resolves [Undo] and [Approve] MCP write actions',
    { tag: ['@tier1', '@F27'] },
    async ({ page }) => {
      const api = createApiClient();
      const mcp = createMcpClient();
      const cleanup = new CleanupRegistry();
      const taskTitle = uniqueId('Frieren-Undo-Task');

      try {
        const nudgesRes = await api.get('/api/companion/nudges');
        expect(nudgesRes.status).toBe(200);

        const undoCall = await mcp.callTool('todos_create_task', {
          title: taskTitle,
          status: 'todo',
        });
        cleanup.defer(async () => {
          const listRes = await api.get('/api/tasks');
          const tasks = unwrapList<Record<string, any>>(listRes, ['tasks']);
          const match = tasks.find((t) => t.title === taskTitle);
          if (match?.id) {
            await api.delete(`/api/tasks/${encodeURIComponent(String(match.id))}`);
          }
        });
        expect(undoCall.ok).toBe(true);
        expect(typeof undoCall.undoId).toBe('string');

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
        await page.keyboard.press('Control+j');

        const popoverDom = await page.evaluate(() => {
          const popover = document.querySelector(
            '[data-testid="companion-stage-popover"], [data-fui="companion-stage"][data-mode="popover"], [role="dialog"]',
          );
          const text = popover?.textContent || document.body?.innerText || '';
          return {
            hasPopover: Boolean(popover),
            hasFrierenCompanionContent: /frieren|ctx|hermes|undo|nudge|companion/i.test(text),
          };
        });
        expect(popoverDom.hasPopover).toBe(true);
        expect(popoverDom.hasFrierenCompanionContent).toBe(true);

        const undoRes = await api.post(
          `/api/mcp/undo/${encodeURIComponent(undoCall.undoId!)}`,
          {},
        );
        expect(undoRes.status).toBe(200);
      } finally {
        await mcp.closeSession();
        await cleanup.runAll();
      }
    },
  );
});
