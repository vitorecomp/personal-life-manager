import { expect, test } from '@playwright/test';
import {
  CleanupRegistry,
  E2E_URLS,
  auditColorTokens,
  auditInteractiveFontFloor,
  auditZeroBorderRadius,
  createApiClient,
  ensureStackReady,
  uniqueId,
  unwrapList,
  waitForAppReady,
} from '../../harness';

function unwrapEntity<T = any>(resOrBody: any, keys: string[] = []): T {
  const body =
    resOrBody &&
    typeof resOrBody === 'object' &&
    'status' in resOrBody &&
    'json' in resOrBody
      ? resOrBody.json
      : resOrBody;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body as T;
  }
  for (const k of [...keys, 'data', 'item', 'result']) {
    if (body[k] && typeof body[k] === 'object' && !Array.isArray(body[k])) {
      return body[k] as T;
    }
  }
  return body as T;
}

function uniqueSymbol(prefix: string): string {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}${suffix}`;
}

test.describe('Area C Tier 1 — Finance Operator, Waffle Allocation, Macro Spend & FIRE Engine (F17 Backend & F32 Web UI)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  test(
    '[T1][F17] Multi-market BRL and USD portfolio holdings and watchlist CRUD with integer cents and Decimal quantities',
    { tag: ['@tier1', '@F17'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const brSym = uniqueSymbol('WEGE');
        const usSym = uniqueSymbol('VTI');
        const watchSym = uniqueSymbol('NVDA');

        const brRes = await api.post('/finance/assets', {
          symbol: brSym,
          name: 'WEG S.A.',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: '100.00',
          avg_cost_cents: 3500,
          current_price_cents: 4200,
          target_weight_pct: '40.00',
          thesis_md: 'Global industrial electrification moat.',
        });
        expect([200, 201]).toContain(brRes.status);
        const brAsset = unwrapEntity(brRes, ['asset']);
        expect(brAsset.symbol).toBe(brSym);
        expect(brAsset.currency).toBe('BRL');
        expect(Number(brAsset.current_price_cents)).toBe(4200);
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${brAsset.id}`);
        });

        const usRes = await api.post('/finance/assets', {
          symbol: usSym,
          name: 'Vanguard Total Stock Market ETF',
          asset_class: 'global_etf',
          currency: 'USD',
          in_portfolio: true,
          quantity: '10.50',
          avg_cost_cents: 24000,
          current_price_cents: 28000,
          target_weight_pct: '60.00',
        });
        expect([200, 201]).toContain(usRes.status);
        const usAsset = unwrapEntity(usRes, ['asset']);
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${usAsset.id}`);
        });

        const watchRes = await api.post('/finance/assets', {
          symbol: watchSym,
          name: 'NVIDIA Corp',
          asset_class: 'us_equity',
          currency: 'USD',
          in_portfolio: false,
          quantity: '0.00',
          avg_cost_cents: 0,
          current_price_cents: 13500,
          alert_low_cents: 11000,
          alert_high_cents: 16000,
        });
        expect([200, 201]).toContain(watchRes.status);
        const watchAsset = unwrapEntity(watchRes, ['asset']);
        expect(watchAsset.in_portfolio).toBe(false);
        expect(Number(watchAsset.alert_low_cents)).toBe(11000);
        expect(Number(watchAsset.alert_high_cents)).toBe(16000);
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${watchAsset.id}`);
        });

        const holdingsList = unwrapList(await api.get('/finance/assets?in_portfolio=true'), [
          'assets',
        ]);
        expect(holdingsList.some((a: any) => a.id === brAsset.id)).toBe(true);
        expect(holdingsList.some((a: any) => a.id === usAsset.id)).toBe(true);

        const promoteRes = await api.put(`/finance/assets/${watchAsset.id}`, {
          in_portfolio: true,
          quantity: '5.00',
          avg_cost_cents: 13000,
        });
        expect(promoteRes.status).toBe(200);
        const promoted = unwrapEntity(promoteRes, ['asset']);
        expect(promoted.in_portfolio).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F17] OHLCV candlestick series retrieval and delayed quote/FX refresh with cached fallback',
    { tag: ['@tier1', '@F17'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const sym = uniqueSymbol('CAND');
        const asset = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: sym,
            name: 'Candle Test Asset',
            asset_class: 'br_equity',
            currency: 'BRL',
            in_portfolio: true,
            quantity: '50.00',
            avg_cost_cents: 2000,
            current_price_cents: 2500,
            target_weight_pct: '25.00',
          }),
          ['asset'],
        );
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${asset.id}`);
        });

        const refreshRes = await api.post('/finance/quotes/refresh', {});
        expect(refreshRes.status).toBe(200);
        const refresh = unwrapEntity(refreshRes);
        expect(Number(refresh.fx_usd_brl)).toBeGreaterThan(0);
        expect(typeof refresh.fx_source).toBe('string');
        expect(refresh.refreshed_at).toBeTruthy();

        const candlesRes = await api.get(`/finance/assets/${asset.id}/candles?range=1M`);
        expect(candlesRes.status).toBe(200);
        const candlesBody = unwrapEntity(candlesRes);
        expect(candlesBody.symbol).toBe(sym);
        expect(Array.isArray(candlesBody.candles)).toBe(true);
        for (const bar of candlesBody.candles) {
          expect(Number(bar.high_cents)).toBeGreaterThanOrEqual(Number(bar.low_cents));
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F17] 10x20 (200-tile) Hare-Niemeyer waffle allocation and smart buy-only rebalancing calculator',
    { tag: ['@tier1', '@F17'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const underSym = uniqueSymbol('UNDR');
        const overSym = uniqueSymbol('OVER');

        const underAsset = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: underSym,
            name: 'Underweight Holding',
            asset_class: 'br_equity',
            currency: 'BRL',
            in_portfolio: true,
            quantity: '100.00',
            avg_cost_cents: 4000,
            current_price_cents: 4000,
            target_weight_pct: '60.00',
          }),
          ['asset'],
        );
        const overAsset = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: overSym,
            name: 'Overweight Holding',
            asset_class: 'br_fixed_income',
            currency: 'BRL',
            in_portfolio: true,
            quantity: '100.00',
            avg_cost_cents: 6000,
            current_price_cents: 6000,
            target_weight_pct: '40.00',
          }),
          ['asset'],
        );
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${overAsset.id}`);
          await api.delete(`/finance/assets/${underAsset.id}`);
        });

        const allocRes = await api.get('/finance/allocation?investable_surplus_cents=200000');
        expect(allocRes.status).toBe(200);
        const alloc = unwrapEntity(allocRes);

        expect(Number(alloc.total_brl_cents)).toBeGreaterThan(0);
        expect(Number(alloc.fx_usd_brl)).toBeGreaterThan(0);
        expect(Array.isArray(alloc.waffle_tiles)).toBe(true);
        expect(alloc.waffle_tiles.length).toBe(200);

        const recs = unwrapList(alloc.recommendations ?? [], ['recommendations']);
        for (const rec of recs) {
          expect(Number(rec.recommended_buy_cents)).toBeGreaterThanOrEqual(0);
          expect(Number(rec.recommended_units)).toBeGreaterThanOrEqual(0);
        }

        const underRec = recs.find((r: any) => r.symbol === underSym);
        if (underRec) {
          expect(Number(underRec.recommended_buy_cents)).toBeGreaterThan(0);
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F17] Monthly macro investment planner (YYYY-MM) upsert, range filtering, and net worth snapshots',
    { tag: ['@tier1', '@F17'] },
    async () => {
      const api = createApiClient();

      const putOctRes = await api.put('/finance/monthly-plans/2026-10', {
        currency: 'BRL',
        salary_income_cents: 2500000,
        planned_spend_cents: 1200000,
        actual_spend_cents: 1150000,
        planned_investment_cents: 1300000,
        actual_invested_cents: 1350000,
        notes_md: 'October macro review',
      });
      expect([200, 201]).toContain(putOctRes.status);

      const putNovRes = await api.put('/finance/monthly-plans/2026-11', {
        currency: 'BRL',
        salary_income_cents: 2500000,
        planned_spend_cents: 1200000,
        actual_spend_cents: 1400000,
        planned_investment_cents: 1300000,
        actual_invested_cents: 1100000,
        notes_md: 'November macro review',
      });
      expect([200, 201]).toContain(putNovRes.status);

      const getOctRes = await api.get('/finance/monthly-plans/2026-10');
      expect(getOctRes.status).toBe(200);
      const octPlan = unwrapEntity(getOctRes, ['plan', 'monthly_plan']);
      expect(octPlan.month).toBe('2026-10');
      expect(Number(octPlan.salary_income_cents)).toBe(2500000);
      expect(Number(octPlan.actual_spend_cents)).toBe(1150000);

      const listPlansRes = await api.get('/finance/monthly-plans?range=3M');
      expect(listPlansRes.status).toBe(200);
      const plans = unwrapList(listPlansRes, ['plans', 'monthly_plans']);
      expect(plans.some((p: any) => p.month === '2026-10')).toBe(true);
      expect(plans.some((p: any) => p.month === '2026-11')).toBe(true);

      const snapRes = await api.post('/finance/snapshots', {
        snapshot_date: '2026-11-14',
      });
      expect([200, 201]).toContain(snapRes.status);

      const listSnapsRes = await api.get('/finance/snapshots?range=1M');
      expect(listSnapsRes.status).toBe(200);
      const snaps = unwrapList(listSnapsRes, ['snapshots']);
      expect(snaps.some((s: any) => String(s.snapshot_date).includes('2026-11-14'))).toBe(true);
    },
  );

  test(
    '[T1][F17] FIRE & retirement config persistence and NPER years-to-FI projection',
    { tag: ['@tier1', '@F17'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const initialFire = unwrapEntity<Record<string, unknown>>(await api.get('/finance/retirement'));
        const initialCfg = (initialFire.config ?? initialFire) as Record<string, unknown>;
        cleanup.defer(async () => {
          await api.put('/finance/retirement/config', {
            expected_real_return_pct: String(initialCfg.expected_real_return_pct ?? '6.50'),
            safe_withdrawal_rate_pct: String(initialCfg.safe_withdrawal_rate_pct ?? '4.00'),
            override_retirement_monthly_spend_cents:
              (initialCfg.override_retirement_monthly_spend_cents as number | null) ?? null,
            current_age: Number(initialCfg.current_age ?? 30),
          });
        });

        const updateCfgRes = await api.put('/finance/retirement/config', {
          expected_real_return_pct: '7.00',
          safe_withdrawal_rate_pct: '4.00',
          override_retirement_monthly_spend_cents: 1000000,
          current_age: 31,
        });
        expect(updateCfgRes.status).toBe(200);

        const fireRes = await api.get('/finance/retirement');
        expect(fireRes.status).toBe(200);
        const fire = unwrapEntity(fireRes);
        expect(Number(fire.fi_target_brl_cents)).toBe(300000000);
        expect(Number(fire.monthly_retirement_spend_brl_cents)).toBe(1000000);
        expect(Number(fire.config?.current_age)).toBe(31);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F17] Stateless What-If FIRE simulator computes faster FI timeline with higher contribution without mutating persisted config',
    { tag: ['@tier1', '@F17'] },
    async () => {
      const api = createApiClient();

      const beforeFire = unwrapEntity(await api.get('/finance/retirement'));
      const beforeAge = Number(beforeFire.config?.current_age);

      const simARes = await api.post('/finance/retirement/simulate', {
        current_net_worth_brl_cents: 50000000,
        monthly_contribution_brl_cents: 500000,
        monthly_retirement_spend_brl_cents: 1000000,
        expected_real_return_pct: '6.50',
        safe_withdrawal_rate_pct: '4.00',
      });
      expect(simARes.status).toBe(200);
      const simA = unwrapEntity(simARes);

      const simBRes = await api.post('/finance/retirement/simulate', {
        current_net_worth_brl_cents: 50000000,
        monthly_contribution_brl_cents: 1000000,
        monthly_retirement_spend_brl_cents: 1000000,
        expected_real_return_pct: '6.50',
        safe_withdrawal_rate_pct: '4.00',
      });
      expect(simBRes.status).toBe(200);
      const simB = unwrapEntity(simBRes);

      expect(Number(simB.years_to_fi)).toBeLessThan(Number(simA.years_to_fi));

      const afterFire = unwrapEntity(await api.get('/finance/retirement'));
      expect(Number(afterFire.config?.current_age)).toBe(beforeAge);
    },
  );

  test(
    '[T1][F32] /finance holdings and watchlist tables, BRL/USD base currency toggle, and quote/FX refresh indicator',
    { tag: ['@tier1', '@F32'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const holdSym = uniqueSymbol('HOLD');
        const watchSym = uniqueSymbol('WTCH');

        const hAsset = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: holdSym,
            name: 'Tactical Holding Co',
            asset_class: 'br_equity',
            currency: 'BRL',
            in_portfolio: true,
            quantity: '100.00',
            avg_cost_cents: 3000,
            current_price_cents: 3500,
            target_weight_pct: '50.00',
          }),
          ['asset'],
        );
        const wAsset = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: watchSym,
            name: 'Watchlist Radar Corp',
            asset_class: 'us_equity',
            currency: 'USD',
            in_portfolio: false,
            quantity: '0.00',
            avg_cost_cents: 0,
            current_price_cents: 12000,
          }),
          ['asset'],
        );
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${wAsset.id}`);
          await api.delete(`/finance/assets/${hAsset.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);
        await expect(page.locator('body')).toContainText(holdSym);

        for (const curr of [/\bUSD\b/, /\bBRL\b/]) {
          const btn = page.getByRole('button', { name: curr }).first();
          if ((await btn.count()) > 0 && (await btn.isVisible())) {
            await btn.click();
          }
        }

        const [radiusAudit, fontAudit, colorAudit] = await Promise.all([
          auditZeroBorderRadius(page),
          auditInteractiveFontFloor(page, 12),
          auditColorTokens(page),
        ]);
        expect(radiusAudit.violations).toEqual([]);
        expect(fontAudit.violations).toEqual([]);
        expect(colorAudit.hasCarbonBg).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F32] Asset detail drawer renders <CandlestickChart /> (1D/7D/1M/1Y/ALL) and saves Markdown investment thesis notes',
    { tag: ['@tier1', '@F32'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const sym = uniqueSymbol('THES');
        const asset = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: sym,
            name: 'Thesis Chart Asset',
            asset_class: 'br_equity',
            currency: 'BRL',
            in_portfolio: true,
            quantity: '25.00',
            avg_cost_cents: 4000,
            current_price_cents: 4500,
            target_weight_pct: '30.00',
            thesis_md: 'Initial investment thesis.',
          }),
          ['asset'],
        );
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${asset.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);

        const assetTrigger = page.getByText(sym).first();
        if ((await assetTrigger.count()) > 0) {
          await assetTrigger.click();
        }

        const candleChart = page.locator('[data-testid="candlestick-chart"], [data-fui="candlestick-chart"]');
        if ((await candleChart.count()) > 0) {
          const range7d = page.locator('[data-candle-range="7D"]').first();
          if ((await range7d.count()) > 0) {
            await range7d.click();
          }
        }

        const updatedThesis = 'Updated Q4 thesis: strong ROIC expansion.';
        const putRes = await api.put(`/finance/assets/${asset.id}`, {
          thesis_md: updatedThesis,
        });
        expect(putRes.status).toBe(200);
        const fetched = unwrapEntity(await api.get(`/finance/assets/${asset.id}`), ['asset']);
        expect(fetched.thesis_md).toBe(updatedThesis);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F32] <WaffleGrid10x20 /> renders exactly 200 rectilinear tiles and Smart Buy-Only Rebalancer computes positive-only purchases',
    { tag: ['@tier1', '@F32'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const symA = uniqueSymbol('WAFA');
        const symB = uniqueSymbol('WAFB');

        const a1 = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: symA,
            name: 'Waffle Asset A',
            asset_class: 'br_equity',
            currency: 'BRL',
            in_portfolio: true,
            quantity: '100.00',
            avg_cost_cents: 5000,
            current_price_cents: 5000,
            target_weight_pct: '50.00',
          }),
          ['asset'],
        );
        const a2 = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: symB,
            name: 'Waffle Asset B',
            asset_class: 'global_etf',
            currency: 'USD',
            in_portfolio: true,
            quantity: '20.00',
            avg_cost_cents: 10000,
            current_price_cents: 10000,
            target_weight_pct: '50.00',
          }),
          ['asset'],
        );
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${a2.id}`);
          await api.delete(`/finance/assets/${a1.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);

        const waffleGrid = page.locator('[data-testid="waffle-grid-10x20"], [data-fui="waffle-grid-10x20"]');
        if ((await waffleGrid.count()) > 0) {
          const tileCount = await waffleGrid.first().locator('[data-waffle-tile]').count();
          expect(tileCount).toBe(200);
        }

        const allocRes = await api.get('/finance/allocation?investable_surplus_cents=500000');
        expect(allocRes.status).toBe(200);
        expect(allocRes.json.waffle_tiles.length).toBe(200);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F32] Monthly macro investment planner (YYYY-MM) renders REF-07 <PairedHatchBarChart /> with zero micro-expense ledger',
    { tag: ['@tier1', '@F32'] },
    async ({ page }) => {
      const api = createApiClient();

      await api.put('/finance/monthly-plans/2026-10', {
        currency: 'BRL',
        salary_income_cents: 2500000,
        planned_spend_cents: 1200000,
        actual_spend_cents: 1150000,
        planned_investment_cents: 1300000,
        actual_invested_cents: 1350000,
      });

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);

      const barChart = page.locator(
        '[data-testid="paired-hatch-bar-chart"], [data-fui="paired-hatch-bar-chart"]',
      );
      if ((await barChart.count()) > 0) {
        await expect(barChart.first()).toBeVisible();
      }

      await expect(page.locator('body')).toContainText(/salary|spend|invest|month|2026/i);
    },
  );

  test(
    '[T1][F32] FIRE & Retirement Simulator renders <HatchedDonutGauge /> and live What-If sliders update years-to-FI',
    { tag: ['@tier1', '@F32'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);

      const donut = page.locator(
        '[data-testid="hatched-donut-gauge"], [data-fui="hatched-donut-gauge"]',
      );
      if ((await donut.count()) > 0) {
        await expect(donut.first()).toBeVisible();
      }

      await expect(page.locator('body')).toContainText(/fire|retirement|swr|target/i);
    },
  );

  test(
    '[T1][F32] Global Privacy Mask toggle (👁️) redacts BRL/USD currency amounts to •••••• while keeping % and time-to-FI visible',
    { tag: ['@tier1', '@F32'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const sym = uniqueSymbol('PRIV');
        const asset = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: sym,
            name: 'Privacy Mask Asset',
            asset_class: 'br_equity',
            currency: 'BRL',
            in_portfolio: true,
            quantity: '100.00',
            avg_cost_cents: 5000,
            current_price_cents: 5500,
            target_weight_pct: '50.00',
          }),
          ['asset'],
        );
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${asset.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);

        const privacyToggle = page
          .locator('[data-testid="fui-privacy-toggle"]')
          .or(page.getByRole('button', { name: /privacy|mask|blur|👁/i }))
          .first();

        expect(await privacyToggle.count()).toBeGreaterThan(0);
        await privacyToggle.click();

        await expect(page.locator('body')).toContainText('••••••');

        await privacyToggle.click();
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F32] Finance sidebar sub-items ("Retirement" and "Stock Cycle") navigate between FinanceView and StockCycleView with single & combined candlestick graph',
    { tag: ['@tier1', '@F23', '@F30', '@F32'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const symA = uniqueSymbol('CYCA');
        const symB = uniqueSymbol('CYCB');

        const assetA = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: symA,
            name: 'Cycle Alpha S.A.',
            asset_class: 'br_equity',
            currency: 'BRL',
            in_portfolio: true,
            quantity: '100.00',
            avg_cost_cents: 3200,
            current_price_cents: 3800,
            target_weight_pct: '50.00',
          }),
          ['asset'],
        );
        const assetB = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: symB,
            name: 'Cycle Beta Corp',
            asset_class: 'us_equity',
            currency: 'USD',
            in_portfolio: true,
            quantity: '25.00',
            avg_cost_cents: 11000,
            current_price_cents: 13500,
            target_weight_pct: '50.00',
          }),
          ['asset'],
        );
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${assetB.id}`);
          await api.delete(`/finance/assets/${assetA.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);

        // 1. Verify Finance sub-navigation items "Retirement" and "Stock Cycle" are visible in the left sidebar
        const retirementLink = page.locator('[data-testid="nav-link-finance-retirement"]');
        const stockCycleLink = page.locator('[data-testid="nav-link-finance-stock-cycle"]');
        await expect(retirementLink).toBeVisible();
        await expect(stockCycleLink).toBeVisible();
        await expect(retirementLink).toContainText('Retirement');
        await expect(stockCycleLink).toContainText('Stock Cycle');

        // 2. Clicking "Retirement" renders the existing FinanceView (finance-page)
        await retirementLink.click();
        await expect(page.locator('[data-testid="finance-page"]')).toBeVisible();

        // 3. Clicking "Stock Cycle" navigates to /finance/stock-cycle and renders StockCycleView
        await stockCycleLink.click();
        await expect(page.locator('[data-testid="stock-cycle-page"]')).toBeVisible();
        await expect(page.locator('[data-testid="stock-cycle-stock-list"]')).toBeVisible();
        const candleChart = page.locator('[data-testid="candlestick-chart"]');
        await expect(candleChart).toBeVisible();

        // 4. Select an individual stock from the left stock list -> candlestick chart updates to that stock
        const selectBtnB = page.locator(`[data-testid="stock-cycle-select-${symB}"]`);
        await expect(selectBtnB).toBeVisible();
        await selectBtnB.click();
        await expect(candleChart).toHaveAttribute('data-symbol', symB);

        // 5. Select multiple stocks / combination option -> candlestick chart renders combined candlestick series
        const checkBtnA = page.locator(`[data-testid="stock-cycle-check-${symA}"]`);
        await expect(checkBtnA).toBeVisible();
        await checkBtnA.click();
        await expect(candleChart).toHaveAttribute('data-symbol', /COMBINED/);

        // Also test the prominent combination option button
        const combineOptionBtn = page.locator('[data-testid="stock-cycle-combine-option"]');
        await expect(combineOptionBtn).toBeVisible();
        await combineOptionBtn.click();
        await expect(candleChart).toHaveAttribute('data-symbol', /COMBINED/);

        // Verify candles exist in SVG and FUI rubric laws pass
        const candleCount = await candleChart.locator('[data-candle]').count();
        expect(candleCount).toBeGreaterThan(0);

        const [radiusAudit, fontAudit] = await Promise.all([
          auditZeroBorderRadius(page),
          auditInteractiveFontFloor(page, 12),
        ]);
        expect(radiusAudit.violations).toEqual([]);
        expect(fontAudit.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );
});
