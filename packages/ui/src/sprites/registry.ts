import rawFrierenMini from '../assets/sprites/frieren-mini.json' with { type: 'json' };
import rawFrierenPortrait from '../assets/sprites/frieren-portrait.json' with { type: 'json' };
import rawKnightsIsometric from '../assets/sprites/knights-isometric.json' with { type: 'json' };
import type {
  AsepriteFrameEntry,
  CompanionAnimationHint,
  CompanionAnimationName,
  CompanionOfflinePhrase,
  NormalizedAnimation,
  NormalizedSpriteSheet,
  PixelScale,
  ResolvedSpriteFrame,
  SpriteSheetDescriptor,
} from './types';

export const FRIEREN_MINI_SPRITE: SpriteSheetDescriptor = rawFrierenMini as SpriteSheetDescriptor;
export const FRIEREN_PORTRAIT_SPRITE: SpriteSheetDescriptor = rawFrierenPortrait as SpriteSheetDescriptor;
export const KNIGHTS_ISOMETRIC_SPRITE: SpriteSheetDescriptor = rawKnightsIsometric as SpriteSheetDescriptor;

export const FRIEREN_MINI_SHEET_URL: string = new URL(
  '../assets/sprites/frieren-mini.png',
  import.meta.url,
).href;
export const FRIEREN_PORTRAIT_SHEET_URL: string = new URL(
  '../assets/sprites/frieren-portrait.png',
  import.meta.url,
).href;
export const KNIGHTS_ISOMETRIC_SHEET_URL: string = new URL(
  '../assets/sprites/knights-isometric.png',
  import.meta.url,
).href;

export const DEFAULT_COMPANION_OFFLINE_PHRASES: readonly CompanionOfflinePhrase[] = [
  {
    id: 'phrase-1',
    phraseText: 'Consistency is the most reliable magic.',
    triggerContext: 'any',
    animationHint: 'read_grimoire',
  },
  {
    id: 'phrase-2',
    phraseText: 'Uplink is out of range—handle the task in front of you first.',
    triggerContext: 'screen_open',
    animationHint: 'wind_blink_loop',
  },
  {
    id: 'phrase-3',
    phraseText: "Even a thousand-year journey is just today's routine repeated.",
    triggerContext: 'routine_done',
    animationHint: 'cast_blue_flora',
  },
  {
    id: 'phrase-4',
    phraseText: 'Himmel used to say small daily habits outlast grand speeches.',
    triggerContext: 'any',
    animationHint: 'sip_tea',
  },
  {
    id: 'phrase-5',
    phraseText: 'A quiet grimoire and one finished task beat ten abandoned plans.',
    triggerContext: 'todo_done',
    animationHint: 'read_grimoire',
  },
  {
    id: 'phrase-6',
    phraseText: 'Mana stabilization takes centuries; twenty-five focused minutes is easy.',
    triggerContext: 'tap',
    animationHint: 'wind_blink_loop',
  },
  {
    id: 'phrase-7',
    phraseText: 'Check your morning stack before chasing rare spells.',
    triggerContext: 'any',
    animationHint: 'cozy_nap',
  },
  {
    id: 'phrase-8',
    phraseText: 'Wait—that chest is definitely a grimoire, not a Mimic. Back to your tasks.',
    triggerContext: 'tap',
    animationHint: 'mimic_gag',
  },
];

/**
 * Clamps any numeric or string sprite scale to integer `2 | 3 | 4`.
 */
export function clampSpriteScale(raw?: PixelScale | number | string | null): PixelScale {
  if (raw === undefined || raw === null || raw === '') return 2;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 2;
  const rounded = Math.round(n);
  if (rounded <= 2) return 2;
  if (rounded >= 4) return 4;
  return rounded as PixelScale;
}

/**
 * Maps canonical names and database `animation_hint` aliases to valid animation keys.
 */
export function resolveCompanionAnimationKey(
  input?: CompanionAnimationHint | string | null,
  surface: 'mini' | 'portrait' = 'mini',
): CompanionAnimationName {
  const key = (input ?? '').trim().toLowerCase();
  if (surface === 'portrait') {
    if (key === 'calm_gaze' || key === 'idle_gaze') return 'calm_gaze';
    return 'wind_blink_loop';
  }

  switch (key) {
    case 'idle_ledge_sit':
    case 'idle_gaze':
    case 'calm_gaze':
    case 'stargazing':
    case 'wind_blink':
    case 'wind_blink_loop':
      return 'idle_ledge_sit';
    case 'walk_ledge':
      return 'walk_ledge';
    case 'read_grimoire':
    case 'reading_grimoire':
    case 'grimoire':
      return 'read_grimoire';
    case 'cast_blue_flora':
    case 'blue_flower_spell':
    case 'casting':
      return 'cast_blue_flora';
    case 'sip_tea':
    case 'tea':
      return 'sip_tea';
    case 'cozy_nap':
    case 'nod_off':
    case 'sleeping':
      return 'cozy_nap';
    case 'mimic_gag':
      return 'mimic_gag';
    default:
      return 'idle_ledge_sit';
  }
}

function validateFrameBounds(frame: ResolvedSpriteFrame, sheetW: number, sheetH: number): boolean {
  return (
    Number.isFinite(frame.x) &&
    Number.isFinite(frame.y) &&
    Number.isFinite(frame.w) &&
    Number.isFinite(frame.h) &&
    frame.w > 0 &&
    frame.h > 0 &&
    frame.x >= 0 &&
    frame.y >= 0 &&
    frame.x + frame.w <= sheetW &&
    frame.y + frame.h <= sheetH
  );
}

/**
 * Normalizes both HERMES row-strip `animations` and Aseprite JSON `frames` + `meta.frameTags`.
 * Falls back cleanly to `fallback` (or `FRIEREN_MINI_SPRITE`) if invalid.
 */
export function normalizeSpriteDescriptor(
  descriptor: SpriteSheetDescriptor | null | undefined,
  fallback: SpriteSheetDescriptor = FRIEREN_MINI_SPRITE,
  onInvalid?: (reason: string) => void,
): NormalizedSpriteSheet {
  const fail = (reason: string): NormalizedSpriteSheet => {
    onInvalid?.(reason);
    if (descriptor !== fallback) {
      return normalizeSpriteDescriptor(fallback, FRIEREN_MINI_SPRITE);
    }
    return {
      image: 'frieren-mini.png',
      size: { w: 256, h: 224 },
      frameSize: { w: 32, h: 32 },
      scale: 2,
      animations: {
        idle_ledge_sit: {
          name: 'idle_ledge_sit',
          loop: true,
          fps: 8,
          frames: [{ x: 0, y: 0, w: 32, h: 32, durationMs: 125 }],
        },
      },
      defaultAnimation: 'idle_ledge_sit',
    };
  };

  if (!descriptor || typeof descriptor !== 'object' || !descriptor.meta) {
    return fail('Missing descriptor or meta block');
  }

  const { meta } = descriptor;
  const sheetW = Number(meta.size?.w);
  const sheetH = Number(meta.size?.h);
  if (!Number.isFinite(sheetW) || !Number.isFinite(sheetH) || sheetW <= 0 || sheetH <= 0) {
    return fail('Invalid sprite sheet meta.size dimensions');
  }

  const scale = clampSpriteScale(meta.scale);
  const animations: Record<string, NormalizedAnimation> = {};

  // Mode A: Native HERMES row-strip animations
  if (descriptor.animations && Object.keys(descriptor.animations).length > 0) {
    const fw = Number(meta.frameSize?.w);
    const fh = Number(meta.frameSize?.h);
    if (!Number.isFinite(fw) || !Number.isFinite(fh) || fw <= 0 || fh <= 0) {
      return fail('Invalid meta.frameSize dimensions');
    }

    for (const [animName, def] of Object.entries(descriptor.animations)) {
      const count = Number(def?.frames);
      const row = Number(def?.row);
      const startCol = Number(def?.startCol ?? 0);
      const fps = Math.min(60, Math.max(1, Number(def?.fps) || 8));
      if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(row) || row < 0 || startCol < 0) {
        return fail(`Invalid animation definition for "${animName}"`);
      }

      const resolvedFrames: ResolvedSpriteFrame[] = [];
      for (let i = 0; i < count; i++) {
        const frame: ResolvedSpriteFrame = {
          x: (startCol + i) * fw,
          y: row * fh,
          w: fw,
          h: fh,
          durationMs: def.frameDurationsMs?.[i] ?? Math.round(1000 / fps),
        };
        if (!validateFrameBounds(frame, sheetW, sheetH)) {
          return fail(`Animation "${animName}" frame ${i} exceeds sheet bounds (${sheetW}x${sheetH})`);
        }
        resolvedFrames.push(frame);
      }

      animations[animName] = {
        name: animName,
        loop: Boolean(def.loop),
        fps,
        frames: resolvedFrames,
      };
    }

    const keys = Object.keys(animations);
    if (keys.length === 0) {
      return fail('No valid animations in descriptor');
    }

    return {
      image: meta.image || 'sprite.png',
      size: { w: sheetW, h: sheetH },
      frameSize: { w: fw, h: fh },
      scale,
      animations,
      defaultAnimation: keys[0]!,
    };
  }

  // Mode B: External Aseprite frames (Hash or Array) + meta.frameTags
  if (descriptor.frames) {
    const entries: AsepriteFrameEntry[] = Array.isArray(descriptor.frames)
      ? descriptor.frames
      : Object.values(descriptor.frames);
    if (entries.length === 0) {
      return fail('Empty Aseprite frames collection');
    }

    const first = entries[0]!;
    const fw = Number(meta.frameSize?.w ?? first.sourceSize?.w ?? first.frame?.w);
    const fh = Number(meta.frameSize?.h ?? first.sourceSize?.h ?? first.frame?.h);
    if (!Number.isFinite(fw) || !Number.isFinite(fh) || fw <= 0 || fh <= 0) {
      return fail('Invalid Aseprite frame dimensions');
    }

    const toResolved = (entry: AsepriteFrameEntry): ResolvedSpriteFrame | null => {
      if (!entry?.frame) return null;
      const durationMs = Math.max(16, Number(entry.duration) || 100);
      const rf: ResolvedSpriteFrame = {
        x: Number(entry.frame.x),
        y: Number(entry.frame.y),
        w: Number(entry.frame.w),
        h: Number(entry.frame.h),
        durationMs,
      };
      return validateFrameBounds(rf, sheetW, sheetH) ? rf : null;
    };

    const allResolved: ResolvedSpriteFrame[] = [];
    for (const e of entries) {
      const r = toResolved(e);
      if (!r) return fail('Aseprite frame out of bounds');
      allResolved.push(r);
    }

    if (meta.frameTags && meta.frameTags.length > 0) {
      for (const tag of meta.frameTags) {
        const from = Math.max(0, Number(tag.from) || 0);
        const to = Math.min(allResolved.length - 1, Number(tag.to) || 0);
        if (to < from) continue;
        const indices: number[] = [];
        if (tag.direction === 'reverse') {
          for (let i = to; i >= from; i--) indices.push(i);
        } else if (tag.direction === 'pingpong') {
          for (let i = from; i <= to; i++) indices.push(i);
          for (let i = to - 1; i > from; i--) indices.push(i);
        } else {
          for (let i = from; i <= to; i++) indices.push(i);
        }
        const tagFrames = indices.map((idx) => allResolved[idx]!).filter(Boolean);
        if (tagFrames.length > 0) {
          const avgDuration = tagFrames.reduce((acc, f) => acc + f.durationMs, 0) / tagFrames.length;
          animations[tag.name] = {
            name: tag.name,
            loop: tag.repeat === undefined || Number(tag.repeat) === 0,
            fps: Math.max(1, Math.round(1000 / avgDuration)),
            frames: tagFrames,
          };
        }
      }
    }

    if (Object.keys(animations).length === 0) {
      animations.default = {
        name: 'default',
        loop: true,
        fps: 10,
        frames: allResolved,
      };
    }

    const keys = Object.keys(animations);
    return {
      image: meta.image || 'aseprite.png',
      size: { w: sheetW, h: sheetH },
      frameSize: { w: fw, h: fh },
      scale,
      animations,
      defaultAnimation: keys[0]!,
    };
  }

  return fail('Descriptor contains neither animations nor frames');
}
