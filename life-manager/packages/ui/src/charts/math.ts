import { FUI_TOKENS } from '../tokens';

export interface WaffleSliceInput {
  id: string;
  label: string;
  /** Percentage weight (e.g. 40, 25) OR raw positive value normalized automatically. */
  weight?: number;
  /** Optional alias for weight */
  weightPct?: number;
  /** Optional target weight % for drift display in Finance Operator (11:32). */
  targetWeightPct?: number;
  /** Optional currency value in minor units (masked when privacyMasked is true). */
  valueCents?: number;
  /** Optional tile hex color override; defaults to REF-07 4-step monochrome/tactical ramp. */
  color?: string;
}

export interface WaffleAllocatedSlice {
  id: string;
  label: string;
  rawWeight: number;
  normalizedPct: number;
  tileCount: number;
  color: string;
  targetWeightPct?: number;
  driftPct?: number;
  valueCents?: number;
}

export interface WaffleTileCell {
  index: number;
  row: number;
  col: number;
  sliceId: string;
  label: string;
  color: string;
  isUnallocated: boolean;
}

export interface ComputeWaffleOptions {
  /**
   * When `true` and `0 < sum(weight) < 100`, preserves `(100 - sum)` as `'__unallocated__'` tiles
   * and sets `hasWeightDriftWarning: true`. Default `false`.
   */
  preserveUnallocated?: boolean;
}

export interface WaffleComputationResult {
  tiles: WaffleTileCell[];
  slices: WaffleAllocatedSlice[];
  unallocatedTiles: number;
  weightSumPct: number;
  weightDeltaPct: number;
  hasWeightDriftWarning: boolean;
}

export const WAFFLE_PALETTE_RAMP: readonly string[] = [
  FUI_TOKENS.inkStark,
  '#9CA3AF',
  '#525866',
  '#2E3440',
  FUI_TOKENS.accentOrange,
  FUI_TOKENS.accentCyan,
  FUI_TOKENS.accentPhosphor,
];

export const WAFFLE_UNALLOCATED_COLOR = '#262830';

export function sanitizeFinite(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value: unknown, min: number, max: number, fallback = min): number {
  const n = sanitizeFinite(value, fallback);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Computes exact 200-tile (`10x20`) allocation using Largest Remainder (Hare-Niemeyer) rounding.
 */
export function computeWaffleAllocation(
  items: readonly WaffleSliceInput[] | null | undefined,
  options?: ComputeWaffleOptions,
): WaffleComputationResult {
  const preserveUnallocated = Boolean(options?.preserveUnallocated);
  const safeItems = Array.isArray(items) ? items : [];

  const valid = safeItems
    .map((item, idx) => {
      const rawW = sanitizeFinite(item.weight ?? item.weightPct ?? item.valueCents, 0);
      return {
        item,
        rawW: rawW > 0 ? rawW : 0,
        originalIndex: idx,
        color:
          item.color ||
          WAFFLE_PALETTE_RAMP[idx % WAFFLE_PALETTE_RAMP.length] ||
          FUI_TOKENS.inkStark,
      };
    })
    .filter((v) => v.rawW > 0);

  const rawSum = valid.reduce((acc, v) => acc + v.rawW, 0);
  const weightSumPct = Number(rawSum.toFixed(4));
  const weightDeltaPct = Number((weightSumPct - 100).toFixed(4));
  const hasWeightDriftWarning = rawSum <= 0 || Math.abs(weightSumPct - 100) > 0.05;

  if (valid.length === 0 || rawSum <= 0) {
    const emptyTiles: WaffleTileCell[] = Array.from({ length: 200 }).map((_, index) => ({
      index,
      row: index % 10,
      col: Math.floor(index / 10),
      sliceId: '__unallocated__',
      label: 'Unallocated',
      color: WAFFLE_UNALLOCATED_COLOR,
      isUnallocated: true,
    }));
    return {
      tiles: emptyTiles,
      slices: [],
      unallocatedTiles: 200,
      weightSumPct: 0,
      weightDeltaPct: -100,
      hasWeightDriftWarning: true,
    };
  }

  interface WorkingBucket {
    id: string;
    label: string;
    rawWeight: number;
    p: number;
    color: string;
    isUnallocated: boolean;
    originalIndex: number;
    targetWeightPct?: number;
    valueCents?: number;
  }

  const buckets: WorkingBucket[] = [];
  const useUnallocatedGap = preserveUnallocated && rawSum < 99.999;
  const denom = useUnallocatedGap ? 100 : rawSum;

  for (const v of valid) {
    buckets.push({
      id: v.item.id,
      label: v.item.label,
      rawWeight: v.rawW,
      p: v.rawW / denom,
      color: v.color,
      isUnallocated: false,
      originalIndex: v.originalIndex,
      targetWeightPct: v.item.targetWeightPct,
      valueCents: v.item.valueCents,
    });
  }

  if (useUnallocatedGap) {
    buckets.push({
      id: '__unallocated__',
      label: 'Unallocated',
      rawWeight: 100 - rawSum,
      p: (100 - rawSum) / 100,
      color: WAFFLE_UNALLOCATED_COLOR,
      isUnallocated: true,
      originalIndex: valid.length + 1,
    });
  }

  const quotas = buckets.map((b, idx) => {
    const exact = 200 * b.p;
    const floor = Math.floor(exact);
    const rem = exact - floor;
    return { idx, floor, rem, p: b.p, originalIndex: b.originalIndex };
  });

  const floorSum = quotas.reduce((acc, q) => acc + q.floor, 0);
  const deficit = Math.max(0, 200 - floorSum);

  const ranked = [...quotas].sort(
    (a, b) => b.rem - a.rem || b.p - a.p || a.originalIndex - b.originalIndex,
  );

  const tileCounts = new Array<number>(buckets.length).fill(0);
  for (const q of quotas) {
    tileCounts[q.idx] = q.floor;
  }
  for (let i = 0; i < deficit && i < ranked.length; i++) {
    const winner = ranked[i]!;
    tileCounts[winner.idx] = (tileCounts[winner.idx] ?? 0) + 1;
  }

  const slices: WaffleAllocatedSlice[] = [];
  const tiles: WaffleTileCell[] = [];
  let unallocatedTiles = 0;

  buckets.forEach((b, bIdx) => {
    const count = tileCounts[bIdx] ?? 0;
    const normalizedPct = Number((b.p * 100).toFixed(2));
    if (b.isUnallocated) {
      unallocatedTiles += count;
    } else {
      slices.push({
        id: b.id,
        label: b.label,
        rawWeight: b.rawWeight,
        normalizedPct,
        tileCount: count,
        color: b.color,
        targetWeightPct: b.targetWeightPct,
        driftPct:
          b.targetWeightPct !== undefined
            ? Number((normalizedPct - sanitizeFinite(b.targetWeightPct, 0)).toFixed(2))
            : undefined,
        valueCents: b.valueCents,
      });
    }

    for (let t = 0; t < count; t++) {
      const index = tiles.length;
      tiles.push({
        index,
        row: index % 10,
        col: Math.floor(index / 10),
        sliceId: b.id,
        label: b.label,
        color: b.color,
        isUnallocated: b.isUnallocated,
      });
    }
  });

  // Safety guard: ensure length === 200
  while (tiles.length < 200) {
    const index = tiles.length;
    tiles.push({
      index,
      row: index % 10,
      col: Math.floor(index / 10),
      sliceId: '__unallocated__',
      label: 'Unallocated',
      color: WAFFLE_UNALLOCATED_COLOR,
      isUnallocated: true,
    });
    unallocatedTiles++;
  }

  return {
    tiles: tiles.slice(0, 200),
    slices,
    unallocatedTiles,
    weightSumPct,
    weightDeltaPct,
    hasWeightDriftWarning,
  };
}

export const computeWaffleTiles = computeWaffleAllocation;
