import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BinaryDotMatrix8x12,
  CandlestickChart,
  computeWaffleAllocation,
  computeWaffleTiles,
  ConstellationMesh,
  FocusBarcode24h,
  HatchedDonutGauge,
  LifeRadarReticle,
  PairedHatchBarChart,
  PrivacyMaskProvider,
  PrivacyMaskToggle,
  WaffleGrid10x20,
  WaveformSparkline,
} from '../index';

function assertZeroNaNAndZeroRadius(root: HTMLElement) {
  const allElements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  for (const el of allElements) {
    expect(window.getComputedStyle(el).borderRadius).toBe('0px');
    for (const attr of Array.from(el.attributes)) {
      expect(attr.value).not.toContain('NaN');
      expect(attr.value).not.toContain('Infinity');
    }
  }
  const buttons = root.querySelectorAll<HTMLElement>('button');
  for (const btn of Array.from(buttons)) {
    expect(Number.parseFloat(window.getComputedStyle(btn).fontSize)).toBeGreaterThanOrEqual(12);
  }
}

describe('F22 — Shared Tactical Telemetry & Finance Visual Charts', () => {
  it('computes exact 200-tile Hare-Niemeyer allocations across edge cases without drift or NaN', () => {
    expect(computeWaffleTiles).toBe(computeWaffleAllocation);

    // 1. 33.33 / 33.33 / 33.34
    const r1 = computeWaffleAllocation([
      { id: 'a', label: 'A', weight: 33.33 },
      { id: 'b', label: 'B', weight: 33.33 },
      { id: 'c', label: 'C', weight: 33.34 },
    ]);
    expect(r1.tiles).toHaveLength(200);
    expect(r1.slices.reduce((s, x) => s + x.tileCount, 0)).toBe(200);
    expect(r1.slices.map((s) => s.tileCount)).toEqual([67, 66, 67]);

    // 2. 6 equal slices at 16.666%
    const r2 = computeWaffleAllocation(
      Array.from({ length: 6 }).map((_, i) => ({
        id: `s${i}`,
        label: `S${i}`,
        weight: 100 / 6,
      })),
    );
    expect(r2.tiles).toHaveLength(200);
    expect(r2.slices.reduce((s, x) => s + x.tileCount, 0)).toBe(200);

    // 3. Empty, all-zero, negative, and NaN weights -> 200 unallocated tiles
    const rEmpty = computeWaffleAllocation([
      { id: 'z', label: 'Zero', weight: 0 },
      { id: 'n', label: 'Neg', weight: -25 },
      { id: 'nan', label: 'NaN', weight: Number.NaN },
    ]);
    expect(rEmpty.tiles).toHaveLength(200);
    expect(rEmpty.unallocatedTiles).toBe(200);

    // 4. preserveUnallocated: true with 85% sum -> 170 allocated + 30 unallocated tiles
    const rUnalloc = computeWaffleAllocation(
      [
        { id: 'eq', label: 'Equities', weight: 50 },
        { id: 'fi', label: 'Fixed Income', weight: 35 },
      ],
      { preserveUnallocated: true },
    );
    expect(rUnalloc.tiles).toHaveLength(200);
    expect(rUnalloc.unallocatedTiles).toBe(30);
    expect(rUnalloc.hasWeightDriftWarning).toBe(true);
  });

  it('renders all 5 telemetry charts and all 4 finance charts with 0px border-radius, exact cell counts, and zero NaN attributes', () => {
    const { container } = render(
      <div>
        <LifeRadarReticle pillars={{ focus: 82, routines: 90, goals: 74, learning: 68 }} />
        <FocusBarcode24h
          sessions={[
            { startMinute: 540, endMinute: 660, intensity: 0.9 },
            { startMinute: 840, endMinute: 960, intensity: 0.75 },
          ]}
          currentMinute={720}
        />
        <BinaryDotMatrix8x12 values={[true, true, 'partial', 'skipped', false]} />
        <WaveformSparkline data={[12.4, 18.2, 15.0, 22.8, 19.5]} variant="impulse" />
        <ConstellationMesh
          nodes={[
            { id: 'n1', label: 'Note 1', x: -0.5, y: 0.2, z: 0.1 },
            { id: 'n2', label: 'Note 2', x: 0.4, y: -0.3, z: -0.2 },
            { id: 'n3', label: 'Note 3', x: 0.1, y: 0.6, z: 0.4 },
          ]}
        />
        <WaffleGrid10x20
          items={[
            { id: 'br', label: 'B3 Equities', weight: 45, valueCents: 4500000 },
            { id: 'us', label: 'US ETFs', weight: 40, valueCents: 4000000 },
            { id: 'btc', label: 'Crypto', weight: 15, valueCents: 1500000 },
          ]}
          totalValueCents={10000000}
        />
        <HatchedDonutGauge
          solidPct={34}
          hatchedPct={18}
          durationLabel="7Y 4M"
          legendItems={[{ label: 'FI Corpus', pct: 34, variant: 'solid', amountCents: 10000000 }]}
        />
        <PairedHatchBarChart
          data={[
            { month: '2026-09', planned: 8000, actual: 7500, income: 18000 },
            { month: '2026-10', planned: 8000, actual: 8600, income: 18000 },
            { month: '2026-11', planned: 8000, actual: null, income: 18000 },
          ]}
        />
        <CandlestickChart
          symbol="WEGE3.SA"
          quoteSource="cached"
          candles={[
            { timestamp: '1', open: 38.0, high: 40.5, low: 37.5, close: 39.8 }, // bullish (hollow)
            { timestamp: '2', open: 39.8, high: 41.2, low: 38.1, close: 38.4 }, // bearish (solid)
            { timestamp: '3', open: 38.4, high: 38.4, low: 38.4, close: 38.4 }, // doji
            { timestamp: '4', open: 39.0, high: 37.0, low: 41.0, close: 40.0 }, // inverted high < low
          ]}
        />
      </div>,
    );

    assertZeroNaNAndZeroRadius(container);

    // Exact 96 cells in BinaryDotMatrix8x12
    expect(container.querySelectorAll('[data-matrix-cell]')).toHaveLength(96);

    // Exact 16x16 grid lines (17 H + 17 V) in ConstellationMesh
    expect(container.querySelectorAll('[data-grid-line-h]')).toHaveLength(17);
    expect(container.querySelectorAll('[data-grid-line-v]')).toHaveLength(17);

    // Exact 200 Waffle tiles & zero pie charts
    expect(container.querySelectorAll('[data-waffle-tile]')).toHaveLength(200);

    // Candlestick hollow bullish vs solid bearish
    const c0 = container.querySelector('[data-candle="0"]')!;
    const c1 = container.querySelector('[data-candle="1"]')!;
    expect(c0.getAttribute('data-candle-polarity')).toBe('bullish');
    expect(c1.getAttribute('data-candle-polarity')).toBe('bearish');
    expect(container.querySelector('[data-candle-body="0"]')?.getAttribute('fill')).toBe('#08080B');
    expect(container.querySelector('[data-candle-body="1"]')?.getAttribute('fill')).toBe('#F6F6F4');
  });

  it('handles empty, single-point, flat, and NaN series gracefully with zero NaN SVG attributes', () => {
    const { container } = render(
      <div>
        <LifeRadarReticle pillars={{ focus: Number.NaN, routines: -20, goals: 150 }} />
        <FocusBarcode24h sessions={[{ startMinute: Number.NaN, endMinute: -10 }]} />
        <WaveformSparkline data={[]} />
        <WaveformSparkline data={[42]} />
        <WaveformSparkline data={[10, 10, 10, Number.NaN]} />
        <ConstellationMesh nodes={[]} />
        <HatchedDonutGauge solidPct={Number.NaN} hatchedPct={250} />
        <PairedHatchBarChart data={[{ month: '2026-11', planned: 0, actual: 0 }]} />
        <CandlestickChart symbol="EMPTY" candles={[]} />
      </div>,
    );

    assertZeroNaNAndZeroRadius(container);
    expect(container.querySelector('[data-waveform-part="single-point-marker"]')).toBeTruthy();
    expect(container.querySelector('[data-candle-part="empty-state"]')).toHaveTextContent(
      '[NO_CANDLE_DATA // EMPTY]',
    );
  });

  it('integrates with <PrivacyMaskProvider /> to redact currency amounts & price axes while preserving %, 200 Waffle tiles, and 7Y 4M', () => {
    const { container } = render(
      <PrivacyMaskProvider defaultMasked={false} storageKey={null}>
        <PrivacyMaskToggle />
        <WaffleGrid10x20
          items={[{ id: 'br', label: 'B3', weight: 100, valueCents: 1234500 }]}
          totalValueCents={1234500}
        />
        <HatchedDonutGauge
          solidPct={34}
          hatchedPct={16}
          durationLabel="7Y 4M"
          legendItems={[{ label: 'Saved', pct: 34, variant: 'solid', amountCents: 9876500 }]}
        />
        <PairedHatchBarChart
          data={[{ month: '2026-11', planned: 8000, actual: 7200, income: 16000 }]}
        />
        <CandlestickChart
          symbol="VOO"
          currency="USD"
          livePrice={542.75}
          candles={[{ timestamp: '1', open: 530, high: 545, low: 528, close: 542.75 }]}
        />
      </PrivacyMaskProvider>,
    );

    expect(container.querySelector('[data-waffle-part="total-value"]')).toHaveTextContent('R$ 12345.00');
    expect(container.querySelector('[data-candle-live-price="true"]')).toHaveTextContent('542.75');

    // Enable Privacy Mask
    fireEvent.click(screen.getByTestId('fui-privacy-toggle'));

    // Currency totals & price axes are redacted
    expect(container.querySelector('[data-waffle-part="total-value"]')).toHaveTextContent('R$ ••••••');
    expect(container.querySelector('[data-donut-legend-amount="0"]')).toHaveTextContent('R$ ••••••');
    expect(container.querySelector('[data-bar-y-tick="1"]')).toHaveTextContent('••••');
    expect(container.querySelector('[data-candle-live-price="true"]')).toHaveTextContent('••••••');

    // Waffle 200 tiles, HatchedDonutGauge 34% & 7Y 4M, and Savings Rate % remain visible!
    expect(container.querySelectorAll('[data-waffle-tile]')).toHaveLength(200);
    expect(container.querySelector('[data-donut-part="center-label"]')).toHaveTextContent('34%');
    expect(container.querySelector('[data-donut-part="duration-label"]')).toHaveTextContent('7Y 4M');
    expect(container.querySelector('[data-bar-part="savings-rate"]')).toHaveTextContent('SAVINGS: 55%');
  });
});
