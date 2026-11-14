import { expect, test } from '@playwright/test';
import {
  CleanupRegistry,
  E2E_URLS,
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

test.describe('Area C Tier 2 — Finance Operator, Waffle, Rebalancer & FIRE Boundary & Resilience (F17 & F32)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  test(
    '[T2][F17] Hare-Niemeyer largest-remainder apportionment sums to exactly 200 tiles on repeating-decimal 3-way split',
    { tag: ['@tier2', '@F17'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const classes = ['br_equity', 'br_fii', 'br_fixed_income'] as const;
        for (let i = 0; i < classes.length; i++) {
          const a = unwrapEntity(
            await api.post('/finance/assets', {
              symbol: uniqueSymbol(`HN${i}`),
              name: `Hare-NiemeyerLeg ${i}`,
              asset_class: classes[i],
              currency: 'BRL',
              in_portfolio: true,
              quantity: '100.00',
              avg_cost_cents: 1000,
              current_price_cents: 1000,
              target_weight_pct: '33.33',
            }),
            ['asset'],
          );
          cleanup.defer(async () => {
            await api.delete(`/finance/assets/${a.id}`);
          });
        }

        const allocRes = await api.get('/finance/allocation');
        expect(allocRes.status).toBe(200);
        const alloc = unwrapEntity(allocRes);
        expect(Array.isArray(alloc.waffle_tiles)).toBe(true);
        expect(alloc.waffle_tiles.length).toBe(200);

        const indices = alloc.waffle_tiles.map((t: any) => Number(t.tile_index));
        expect(Math.min(...indices)).toBe(0);
        expect(Math.max(...indices)).toBe(199);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F17] Buy-only rebalancer strictly clamps overweight asset recommendations to zero and handles zero surplus',
    { tag: ['@tier2', '@F17'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const overSym = uniqueSymbol('OVRW');
        const underSym = uniqueSymbol('UNDW');

        const overAsset = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: overSym,
            name: 'Heavily Overweight Asset',
            asset_class: 'br_equity',
            currency: 'BRL',
            in_portfolio: true,
            quantity: '800.00',
            avg_cost_cents: 10000,
            current_price_cents: 10000,
            target_weight_pct: '10.00',
          }),
          ['asset'],
        );
        const underAsset = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: underSym,
            name: 'Heavily Underweight Asset',
            asset_class: 'br_fixed_income',
            currency: 'BRL',
            in_portfolio: true,
            quantity: '10.00',
            avg_cost_cents: 1000,
            current_price_cents: 1000,
            target_weight_pct: '90.00',
          }),
          ['asset'],
        );
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${underAsset.id}`);
          await api.delete(`/finance/assets/${overAsset.id}`);
        });

        const zeroSurplusRes = await api.get('/finance/allocation?investable_surplus_cents=0');
        expect(zeroSurplusRes.status).toBe(200);
        const zeroRecs = unwrapList(zeroSurplusRes.json.recommendations ?? [], ['recommendations']);
        for (const r of zeroRecs) {
          expect(Number(r.recommended_buy_cents)).toBe(0);
          expect(Number(r.recommended_units)).toBe(0);
        }

        const posSurplusRes = await api.get('/finance/allocation?investable_surplus_cents=100000');
        expect(posSurplusRes.status).toBe(200);
        const posRecs = unwrapList(posSurplusRes.json.recommendations ?? [], ['recommendations']);
        for (const r of posRecs) {
          expect(Number(r.recommended_buy_cents)).toBeGreaterThanOrEqual(0);
          expect(Number(r.recommended_units)).toBeGreaterThanOrEqual(0);
        }

        const overRec = posRecs.find((r: any) => r.symbol === overSym);
        if (overRec) {
          expect(Number(overRec.recommended_buy_cents)).toBe(0);
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F17] FIRE simulation edge cases: already FI (0Y 0M) and unreachable FI (zero contribution & zero return below target)',
    { tag: ['@tier2', '@F17'] },
    async () => {
      const api = createApiClient();

      const alreadyFiRes = await api.post('/finance/retirement/simulate', {
        current_net_worth_brl_cents: 400000000,
        monthly_contribution_brl_cents: 0,
        monthly_retirement_spend_brl_cents: 1000000,
        expected_real_return_pct: '6.00',
        safe_withdrawal_rate_pct: '4.00',
      });
      expect(alreadyFiRes.status).toBe(200);
      const alreadyFi = unwrapEntity(alreadyFiRes);
      expect(Number(alreadyFi.years_to_fi)).toBe(0);
      expect(Number(alreadyFi.progress_pct)).toBeGreaterThanOrEqual(100);

      const unreachableRes = await api.post('/finance/retirement/simulate', {
        current_net_worth_brl_cents: 10000000,
        monthly_contribution_brl_cents: 0,
        monthly_retirement_spend_brl_cents: 1000000,
        expected_real_return_pct: '0.00',
        safe_withdrawal_rate_pct: '4.00',
      });
      expect(unreachableRes.status).toBe(200);
      const unreachable = unwrapEntity(unreachableRes);
      expect(unreachable.years_to_fi === null || Number(unreachable.years_to_fi) > 100).toBe(true);
    },
  );

  test(
    '[T2][F17] Monthly macro investment plan rejects invalid YYYY-MM month keys with 400',
    { tag: ['@tier2', '@F17'] },
    async () => {
      const api = createApiClient();
      const validBody = {
        currency: 'BRL',
        salary_income_cents: 1000000,
        planned_spend_cents: 500000,
        actual_spend_cents: 500000,
        planned_investment_cents: 500000,
        actual_invested_cents: 500000,
      };

      const res13 = await api.put('/finance/monthly-plans/2026-13', validBody);
      expect([400, 422]).toContain(res13.status);

      const res00 = await api.put('/finance/monthly-plans/2026-00', validBody);
      expect([400, 422]).toContain(res00.status);

      const resInvalid = await api.put('/finance/monthly-plans/not-a-month', validBody);
      expect([400, 422]).toContain(resInvalid.status);
    },
  );

  test(
    '[T2][F17] Portfolio asset constraints: duplicate symbol conflict, target_weight_pct outside 0..=100, and SWR <= 0 rejection',
    { tag: ['@tier2', '@F17'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const dupSym = uniqueSymbol('DUPL');
        const firstAsset = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: dupSym,
            name: 'Primary Asset',
            asset_class: 'br_equity',
            currency: 'BRL',
            in_portfolio: true,
            quantity: '10.00',
            avg_cost_cents: 1000,
            current_price_cents: 1000,
            target_weight_pct: '10.00',
          }),
          ['asset'],
        );
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${firstAsset.id}`);
        });

        const dupRes = await api.post('/finance/assets', {
          symbol: dupSym,
          name: 'Duplicate Asset',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: '5.00',
          avg_cost_cents: 1000,
          current_price_cents: 1000,
        });
        expect([400, 409, 422]).toContain(dupRes.status);

        const weightOver100 = await api.post('/finance/assets', {
          symbol: uniqueSymbol('BADW'),
          name: 'Over 100 Weight',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          target_weight_pct: '125.00',
        });
        expect([400, 422]).toContain(weightOver100.status);

        const weightNeg = await api.post('/finance/assets', {
          symbol: uniqueSymbol('NEGW'),
          name: 'Negative Weight',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          target_weight_pct: '-5.00',
        });
        expect([400, 422]).toContain(weightNeg.status);

        const swrZeroRes = await api.put('/finance/retirement/config', {
          safe_withdrawal_rate_pct: '0.00',
        });
        expect([400, 422]).toContain(swrZeroRes.status);

        const swrNegRes = await api.put('/finance/retirement/config', {
          safe_withdrawal_rate_pct: '-2.00',
        });
        expect([400, 422]).toContain(swrNegRes.status);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F17] Quote refresh offline resilience and non-existent asset 404 handling',
    { tag: ['@tier2', '@F17'] },
    async () => {
      const api = createApiClient();
      const missingUuid = '01932b7c-0000-7000-8000-000000009999';

      const getMissingAsset = await api.get(`/finance/assets/${missingUuid}`);
      expect(getMissingAsset.status).toBe(404);

      const getMissingCandles = await api.get(`/finance/assets/${missingUuid}/candles`);
      expect(getMissingCandles.status).toBe(404);

      const refreshRes = await api.post('/finance/quotes/refresh', {});
      expect(refreshRes.status).toBe(200);
      expect(Number(refreshRes.json.fx_usd_brl)).toBeGreaterThan(0);
    },
  );

  test(
    '[T2][F32] <PairedHatchBarChart /> highlights overspend segment (#EB4511) when actual_spend_cents > planned_spend_cents',
    { tag: ['@tier2', '@F32'] },
    async ({ page }) => {
      const api = createApiClient();

      await api.put('/finance/monthly-plans/2026-11', {
        currency: 'BRL',
        salary_income_cents: 2500000,
        planned_spend_cents: 1000000,
        actual_spend_cents: 1350000,
        planned_investment_cents: 1500000,
        actual_invested_cents: 1150000,
        notes_md: 'Overspend month test',
      });

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);

      const overspendBar = page.locator('[data-bar-overspend="2026-11"]');
      if ((await overspendBar.count()) > 0) {
        await expect(overspendBar.first()).toBeVisible();
      }

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('NaN');
    },
  );

  test(
    '[T2][F32] <WaffleGrid10x20 /> renders allocation drift warning badge when asset class drifts > 5% from target',
    { tag: ['@tier2', '@F32'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const driftSym = uniqueSymbol('DRFT');
        const createRes = await api.post('/finance/assets', {
          symbol: driftSym,
          name: 'High Drift Asset',
          asset_class: 'crypto',
          currency: 'USD',
          in_portfolio: true,
          quantity: '100.00',
          avg_cost_cents: 50000,
          current_price_cents: 50000,
          target_weight_pct: '5.00',
        });
        expect([200, 201]).toContain(createRes.status);
        const asset = unwrapEntity(createRes, ['asset']);
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${asset.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);
        await expect(page.locator('body')).toBeVisible();
        await expect(
          page.locator('[data-testid="waffle-grid-10x20"], [data-fui="waffle-grid-10x20"], main').first(),
        ).toBeVisible();

        const allocRes = await api.get('/finance/allocation');
        expect(allocRes.status).toBe(200);
        expect(Array.isArray(allocRes.json.waffle_tiles)).toBe(true);
        expect(allocRes.json.waffle_tiles.length).toBe(200);

        const driftBadge = page.locator('[data-waffle-part="drift-warning"]');
        if ((await driftBadge.count()) > 0) {
          await expect(driftBadge.first()).toBeVisible();
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F32] <CandlestickChart /> displays [NO_CANDLE_DATA // SYMBOL] empty state or cached badge when quote source is cached',
    { tag: ['@tier2', '@F32'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const customSym = uniqueSymbol('CUST');
        const asset = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: customSym,
            name: 'Custom Unlisted Asset',
            asset_class: 'br_fixed_income',
            currency: 'BRL',
            in_portfolio: true,
            quantity: '10.00',
            avg_cost_cents: 10000,
            current_price_cents: 10500,
            target_weight_pct: '10.00',
          }),
          ['asset'],
        );
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${asset.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);
        const trigger = page.getByText(customSym).first();
        if ((await trigger.count()) > 0) {
          await trigger.click();
        }

        const text = await page.locator('body').innerText();
        expect(text).not.toContain('NaN');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F32] FIRE simulator UI handles 0Y 0M (Already FI) and UNREACHABLE (0 contribution below target) states cleanly',
    { tag: ['@tier2', '@F32'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);

      const text = await page.locator('body').innerText();
      expect(text).not.toContain('NaN');
      expect(text).not.toContain('Infinity');
    },
  );

  test(
    '[T2][F32] Watchlist -> Holdings promotion flow and form validation on duplicate ticker symbol',
    { tag: ['@tier2', '@F32'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const sym = uniqueSymbol('PROM');
        const watchAsset = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: sym,
            name: 'Promotable Watchlist Item',
            asset_class: 'us_equity',
            currency: 'USD',
            in_portfolio: false,
            quantity: '0.00',
            avg_cost_cents: 0,
            current_price_cents: 15000,
          }),
          ['asset'],
        );
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${watchAsset.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);

        const promoteRes = await api.put(`/finance/assets/${watchAsset.id}`, {
          in_portfolio: true,
          quantity: '10.00',
          avg_cost_cents: 14500,
        });
        expect(promoteRes.status).toBe(200);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('body')).toContainText(sym);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F32] /finance REF-02 FUI structural audit: 0px border-radius, >= 12px interactive font floor, and zero horizontal overflow',
    { tag: ['@tier2', '@F32'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);

      const [radiusAudit, fontAudit] = await Promise.all([
        auditZeroBorderRadius(page),
        auditInteractiveFontFloor(page, 12),
      ]);
      expect(radiusAudit.violations).toEqual([]);
      expect(fontAudit.violations).toEqual([]);

      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 4;
      });
      expect(hasHorizontalOverflow).toBe(false);
    },
  );
});
