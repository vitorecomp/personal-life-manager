import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivacyMaskProvider } from '@hermes/ui';
import { FinancePage } from './FinancePage';

function renderFinancePage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <PrivacyMaskProvider storageKey={null}>
        <FinancePage />
      </PrivacyMaskProvider>
    </QueryClientProvider>,
  );
}

describe('FinancePage (/finance) — F32 Multi-Market Holdings, Waffle, Rebalancer, Macro Spend, FIRE & Privacy Mask', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function stubFinanceApiMocks(options?: { singleHighDrift?: boolean }) {
    let assetsState: any[] = options?.singleHighDrift
      ? [
          {
            id: '01963000-0000-7000-8000-00000000f001',
            symbol: 'DRFT4',
            name: 'High Drift Crypto Holding',
            asset_class: 'crypto',
            currency: 'USD',
            in_portfolio: true,
            quantity: '50.00',
            avg_cost_cents: 10000,
            current_price_cents: 10000,
            target_weight_pct: '10.00',
            quote_source: 'cached',
            thesis_md: 'Initial drift thesis.',
          },
        ]
      : [
          {
            id: '01963000-0000-7000-8000-00000000f001',
            symbol: 'PETR4_T1',
            name: 'Petrobras PN',
            asset_class: 'br_equity',
            currency: 'BRL',
            in_portfolio: true,
            quantity: '100.00',
            avg_cost_cents: 3250,
            current_price_cents: 3680,
            target_weight_pct: '40.00',
            quote_source: 'cached',
            thesis_md: 'Strong free cashflow yield.',
          },
          {
            id: '01963000-0000-7000-8000-00000000f002',
            symbol: 'VWRA_T1',
            name: 'Vanguard FTSE All-World',
            asset_class: 'global_etf',
            currency: 'USD',
            in_portfolio: true,
            quantity: '20.00',
            avg_cost_cents: 11500,
            current_price_cents: 12800,
            target_weight_pct: '60.00',
            quote_source: 'cached',
            thesis_md: 'Global core allocation.',
          },
          {
            id: '01963000-0000-7000-8000-00000000f003',
            symbol: 'HGLG11_W',
            name: 'CSHG Logistica FII',
            asset_class: 'br_fii',
            currency: 'BRL',
            in_portfolio: false,
            quantity: '0',
            avg_cost_cents: 0,
            current_price_cents: 15800,
            alert_low_cents: 15500,
            alert_high_cents: 17000,
            target_weight_pct: '0.00',
            quote_source: 'manual',
            thesis_md: 'Wait for cap rate expansion.',
          },
        ];

    const candleUrlsRequested: string[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      const bodyObj = init?.body ? JSON.parse(String(init.body)) : {};

      if (url.includes('/api/finance/assets') && url.includes('/candles')) {
        candleUrlsRequested.push(url);
        return new Response(
          JSON.stringify({
            symbol: 'PETR4_T1',
            range_key: url.includes('range=7D') ? '7D' : '1M',
            quote_source: 'cached',
            candles: [
              {
                timestamp: '2026-04-01T00:00:00Z',
                open_cents: 3500,
                high_cents: 3750,
                low_cents: 3450,
                close_cents: 3680,
                volume: 120000,
              },
              {
                timestamp: '2026-04-02T00:00:00Z',
                open_cents: 3680,
                high_cents: 3810,
                low_cents: 3620,
                close_cents: 3790,
                volume: 145000,
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url.startsWith('/api/finance/assets/') && method === 'PUT') {
        const id = decodeURIComponent(url.split('/api/finance/assets/')[1] ?? '');
        const idx = assetsState.findIndex((a) => a.id === id);
        if (idx >= 0) {
          assetsState[idx] = { ...assetsState[idx], ...bodyObj };
          return new Response(JSON.stringify(assetsState[idx]), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      }

      if (url === '/api/finance/assets' && method === 'GET') {
        return new Response(JSON.stringify(assetsState), { status: 200 });
      }

      if (url.startsWith('/api/finance/allocation')) {
        return new Response(
          JSON.stringify({
            base_currency: url.includes('base_currency=USD') ? 'USD' : 'BRL',
            total_brl_cents: 1648000,
            total_usd_cents: 329600,
            fx_usd_brl: '5.0000',
            new_contribution_cents: 500000,
            target_weight_sum_pct: options?.singleHighDrift ? '10.00' : '100.00',
            waffle_tiles: Array.from({ length: 200 }, (_, i) => ({
              tile_index: i,
              symbol: i < 80 ? 'PETR4_T1' : 'VWRA_T1',
              asset_class: i < 80 ? 'br_equity' : 'global_etf',
            })),
            recommendations: [
              {
                asset_id: '01963000-0000-7000-8000-00000000f001',
                symbol: 'PETR4_T1',
                current_weight_pct: '22.33',
                target_weight_pct: '40.00',
                post_buy_weight_pct: '35.00',
                recommended_buy_cents: 500000,
                recommended_units: '135.8696',
              },
              {
                asset_id: '01963000-0000-7000-8000-00000000f002',
                symbol: 'VWRA_T1',
                current_weight_pct: '77.67',
                target_weight_pct: '60.00',
                post_buy_weight_pct: '65.00',
                recommended_buy_cents: 0,
                recommended_units: '0.0000',
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url.startsWith('/api/finance/monthly-plans') && method === 'GET') {
        return new Response(
          JSON.stringify([
            {
              month: '2026-04',
              currency: 'BRL',
              fx_usd_brl: '5.0000',
              salary_income_cents: 1500000,
              planned_spend_cents: 800000,
              actual_spend_cents: 1100000,
              planned_investment_cents: 700000,
              actual_invested_cents: 400000,
              investable_surplus_cents: 400000,
              net_cashflow_cents: 400000,
              savings_rate_pct: 26.7,
              notes_md: 'April overspend test',
            },
            {
              month: '2026-03',
              currency: 'BRL',
              fx_usd_brl: '5.0000',
              salary_income_cents: 2500000,
              planned_spend_cents: 1200000,
              actual_spend_cents: 1100000,
              planned_investment_cents: 1300000,
              actual_invested_cents: 1400000,
              investable_surplus_cents: 1400000,
              net_cashflow_cents: 1400000,
              savings_rate_pct: 56.0,
              notes_md: 'March nominal',
            },
          ]),
          { status: 200 },
        );
      }

      if (url.startsWith('/api/finance/monthly-plans/') && method === 'PUT') {
        return new Response(
          JSON.stringify({
            month: '2026-04',
            ...bodyObj,
            investable_surplus_cents: 1400000,
            net_cashflow_cents: 1400000,
            savings_rate_pct: 56.0,
          }),
          { status: 200 },
        );
      }

      if (url === '/api/finance/retirement' && method === 'GET') {
        return new Response(
          JSON.stringify({
            current_net_worth_brl_cents: 1648000,
            fi_target_brl_cents: 300000000,
            fire_number_cents: 300000000,
            coast_fire_cents: 85000000,
            monthly_contribution_brl_cents: 1400000,
            monthly_retirement_spend_brl_cents: 1000000,
            years_to_fi: 9.5,
            months_to_fi: 114,
            projected_fi_date: '2035-10-01',
            progress_pct: 28.4,
            fi_progress_pct: 28.4,
            passive_income_coverage_pct: 14.2,
            unreachable: false,
            trajectory: [],
            config: {
              id: 1,
              expected_real_return_pct: '6.50',
              safe_withdrawal_rate_pct: '4.00',
              override_retirement_monthly_spend_cents: 1000000,
              macro_class_targets_json: {},
              current_age: 32,
              updated_at: '2026-04-01T00:00:00Z',
            },
          }),
          { status: 200 },
        );
      }

      if (url === '/api/finance/retirement/simulate' && method === 'POST') {
        return new Response(
          JSON.stringify({
            current_net_worth_brl_cents: 1648000,
            fi_target_brl_cents: 240000000,
            fire_number_cents: 240000000,
            coast_fire_cents: 70000000,
            monthly_contribution_brl_cents: 2000000,
            monthly_retirement_spend_brl_cents: 800000,
            years_to_fi: 6.5,
            months_to_fi: 78,
            projected_fi_date: '2032-10-01',
            progress_pct: 35.0,
            fi_progress_pct: 35.0,
            passive_income_coverage_pct: 18.0,
            unreachable: false,
            trajectory: [],
            config: {
              id: 1,
              expected_real_return_pct: '7.00',
              safe_withdrawal_rate_pct: '4.00',
              override_retirement_monthly_spend_cents: 800000,
              macro_class_targets_json: {},
              current_age: 32,
              updated_at: '2026-04-01T00:00:00Z',
            },
          }),
          { status: 200 },
        );
      }

      if (url.startsWith('/api/finance/snapshots')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      return new Response(JSON.stringify({}), { status: 200 });
    });

    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, candleUrlsRequested };
  }

  it('renders BRL & USD holdings, watchlist, 200-tile waffle grid, overspend bar chart, FIRE donut gauge, and candlestick chart with explicit ?range=1M', async () => {
    const { candleUrlsRequested } = stubFinanceApiMocks();
    const { container } = renderFinancePage();

    await waitFor(() => {
      expect(screen.getAllByText('PETR4_T1').length).toBeGreaterThan(0);
      expect(screen.getAllByText('VWRA_T1').length).toBeGreaterThan(0);
      expect(screen.getAllByText('HGLG11_W').length).toBeGreaterThan(0);
    });

    // Verify 200 waffle tiles
    const waffleTiles = container.querySelectorAll('[data-waffle-tile]');
    expect(waffleTiles.length).toBe(200);

    // Verify allocation drift warning badge renders when portfolio weight drifts > 5% from target
    const driftBadge = container.querySelector('[data-waffle-part="drift-warning"]');
    expect(driftBadge).toBeTruthy();

    // Verify 2026-04 overspend bar is rendered via chronological sorting
    await waitFor(() => {
      const overspendBar = container.querySelector('[data-bar-overspend="2026-04"]');
      expect(overspendBar).toBeTruthy();
    });

    // Verify candle endpoint always passes ?range=1M by default
    await waitFor(() => {
      expect(candleUrlsRequested.some((u) => u.includes('?range=1M'))).toBe(true);
    });

    // Verify BRL & USD base currency toggle buttons exist and work
    const usdBtn = screen.getByRole('button', { name: /\bUSD\b/ });
    const brlBtn = screen.getByRole('button', { name: /\bBRL\b/ });
    fireEvent.click(usdBtn);
    fireEvent.click(brlBtn);
  });

  it('promotes watchlist item to active holdings on 1-click and toggles privacy mask (👁️)', async () => {
    stubFinanceApiMocks();
    renderFinancePage();

    await waitFor(() => {
      expect(screen.getByTestId('promote-watchlist-HGLG11_W')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('promote-watchlist-HGLG11_W'));

    await waitFor(() => {
      expect(screen.getByTestId('holding-row-HGLG11_W')).toBeTruthy();
    });

    // Toggle Privacy Mask
    const privacyToggle = screen.getByTestId('finance-privacy-toggle');
    fireEvent.click(privacyToggle);

    await waitFor(() => {
      expect(document.body.textContent).toContain('••••••');
      // Percentages remain visible
      expect(document.body.textContent).toContain('28.4%');
    });
  });

  it('runs stateless FIRE What-If simulation and updates time-to-FIRE readout', async () => {
    stubFinanceApiMocks();
    renderFinancePage();

    await waitFor(() => {
      expect(screen.getByTestId('simulate-fire-btn')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('simulate-fire-btn'));

    await waitFor(() => {
      expect(document.body.textContent).toContain('6Y 6M');
    });
  });
});
