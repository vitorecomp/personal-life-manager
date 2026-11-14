import React, { useEffect, useMemo, useState } from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { FUI_TOKENS } from '../tokens';

export type Vec3 = readonly [number, number, number];

export interface GeodesicMesh {
  vertices: Vec3[];
  edges: Array<[number, number]>;
  faces: Array<[number, number, number]>;
}

export interface ThinkingOrbQueryNode {
  id: string;
  source: 'vault' | 'mcp' | 'gateway';
  label?: string;
  vertexIndex?: number;
}

export interface GeodesicThinkingOrbProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Pixel size of the square SVG viewport (viewBox="0 0 320 320"); default 240 */
  size?: number;
  /** Geodesic subdivision frequency: 1 (12V, 30E, 20F) or 2 (42V, 120E, 80F); default 2 */
  subdivisions?: 1 | 2;
  /** Active Vault / MCP / Gateway queries illuminating specific icosphere vertices */
  activeQueries?: readonly ThinkingOrbQueryNode[];
  /** Number of completed reasoning steps; locks orbital rings when reasoningState === 'complete' */
  completedSteps?: number;
  reasoningState?: 'idle' | 'thinking' | 'complete';
  /** Fixed rotation angle in radians for deterministic snapshots/tests; animates via rAF when omitted */
  rotationRad?: number;
}

function norm3(x: number, y: number, z: number): Vec3 {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function fnv1aHash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function buildGeodesicIcosphere(subdivisions: 1 | 2 = 2): GeodesicMesh {
  const phi = (1 + Math.sqrt(5)) / 2;
  const vertices: Vec3[] = [
    [-1, phi, 0],
    [1, phi, 0],
    [-1, -phi, 0],
    [1, -phi, 0],
    [0, -1, phi],
    [0, 1, phi],
    [0, -1, -phi],
    [0, 1, -phi],
    [phi, 0, -1],
    [phi, 0, 1],
    [-phi, 0, -1],
    [-phi, 0, 1],
  ].map(([x, y, z]) => norm3(x, y, z));

  let faces: Array<[number, number, number]> = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  if (subdivisions === 2) {
    const midCache = new Map<string, number>();
    const midpoint = (i: number, j: number): number => {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      const cached = midCache.get(key);
      if (cached !== undefined) return cached;
      const a = vertices[i]!;
      const b = vertices[j]!;
      const idx = vertices.length;
      vertices.push(norm3(a[0] + b[0], a[1] + b[1], a[2] + b[2]));
      midCache.set(key, idx);
      return idx;
    };
    const nextFaces: Array<[number, number, number]> = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      nextFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nextFaces;
  }

  const edgeSet = new Set<string>();
  const edges: Array<[number, number]> = [];
  for (const [a, b, c] of faces) {
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push(u < v ? [u, v] : [v, u]);
      }
    }
  }

  return { vertices, edges, faces };
}

export function GeodesicThinkingOrb({
  size = 240,
  subdivisions = 2,
  activeQueries = [],
  completedSteps = 0,
  reasoningState = 'thinking',
  rotationRad,
  style,
  ...rest
}: GeodesicThinkingOrbProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const mesh = useMemo(() => buildGeodesicIcosphere(subdivisions), [subdivisions]);
  const [animRad, setAnimRad] = useState<number>(0.42);

  useEffect(() => {
    if (
      rotationRad !== undefined ||
      reasoningState !== 'thinking' ||
      prefersReducedMotion ||
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function'
    ) {
      return undefined;
    }
    let rafId = 0;
    let start: number | null = null;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const elapsed = (ts - start) / 1000;
      setAnimRad(0.42 + elapsed * 0.65);
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [rotationRad, reasoningState, prefersReducedMotion]);

  const yaw = rotationRad !== undefined ? rotationRad : animRad;
  const pitch = 0.32;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);

  const projected = useMemo(() => {
    return mesh.vertices.map(([x, y, z]) => {
      const x1 = x * cosY + z * sinY;
      const z1 = -x * sinY + z * cosY;
      const y2 = y * cosP - z1 * sinP;
      const z2 = y * sinP + z1 * cosP;
      const persp = 3.2 / (3.2 - z2);
      const sx = Number((160 + 66 * x1 * persp).toFixed(2));
      const sy = Number((146 + 66 * y2 * persp).toFixed(2));
      return { sx, sy, z2 };
    });
  }, [mesh.vertices, cosY, sinY, cosP, sinP]);

  const illuminatedMap = useMemo(() => {
    const map = new Map<number, ThinkingOrbQueryNode>();
    for (const q of activeQueries) {
      const vIdx =
        q.vertexIndex !== undefined && q.vertexIndex >= 0 && q.vertexIndex < mesh.vertices.length
          ? q.vertexIndex
          : fnv1aHash(q.id) % mesh.vertices.length;
      map.set(vIdx, q);
    }
    return map;
  }, [activeQueries, mesh.vertices.length]);

  const isLocked = reasoningState === 'complete';
  const yawDeg = Number(((yaw * 180) / Math.PI).toFixed(1));

  return (
    <div
      {...rest}
      data-fui="geodesic-thinking-orb"
      data-reasoning-state={reasoningState}
      data-completed-steps={completedSteps}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        backgroundColor: FUI_TOKENS.bgCarbon,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        padding: '8px',
        borderRadius: '0px',
        ...style,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 320 320"
        role="img"
        aria-label="Hermes High-Level Geodesic Thinking Orb"
        style={{ display: 'block', borderRadius: '0px' }}
      >
        {/* Perspective-Tilted Counter-Rotating Orbital Tick Rings */}
        <g transform="translate(160, 178) scale(1, 0.46)">
          {/* Ring 3: Outer Cyan Arcs + Inscribed Chords */}
          <g
            data-orb-ring="3"
            data-ring-locked={isLocked ? 'true' : 'false'}
            transform={`rotate(${isLocked ? 0 : Number((yawDeg * 0.4).toFixed(1))})`}
          >
            <circle
              cx="0"
              cy="0"
              r="132"
              fill="none"
              stroke={FUI_TOKENS.accentCyan}
              strokeWidth="1.2"
              strokeDasharray="48 16 12 16"
              opacity="0.55"
            />
            <polygon
              points="0,-132 114.3,66 -114.3,66"
              fill="none"
              stroke={FUI_TOKENS.accentCyan}
              strokeWidth="0.9"
              opacity="0.35"
            />
          </g>

          {/* Ring 2: 72 Radial Tick Marks (CCW) */}
          <g
            data-orb-ring="2"
            data-ring-locked={isLocked ? 'true' : 'false'}
            transform={`rotate(${isLocked ? 0 : Number((-yawDeg * 0.75).toFixed(1))})`}
          >
            {Array.from({ length: 72 }).map((_, idx) => {
              const rad = (idx * 5 * Math.PI) / 180;
              const r1 = 104;
              const r2 = idx % 6 === 0 ? 114 : 109;
              return (
                <line
                  key={idx}
                  x1={Number((r1 * Math.cos(rad)).toFixed(2))}
                  y1={Number((r1 * Math.sin(rad)).toFixed(2))}
                  x2={Number((r2 * Math.cos(rad)).toFixed(2))}
                  y2={Number((r2 * Math.sin(rad)).toFixed(2))}
                  stroke={isLocked ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.accentCyan}
                  strokeWidth={idx % 6 === 0 ? '1.6' : '1'}
                  opacity="0.75"
                />
              );
            })}
          </g>

          {/* Ring 1: Equatorial Luminous Halo + Morse Dashes (CW) */}
          <g
            data-orb-ring="1"
            data-ring-locked={isLocked ? 'true' : 'false'}
            transform={`rotate(${isLocked ? 0 : yawDeg})`}
          >
            <circle
              cx="0"
              cy="0"
              r="86"
              fill="none"
              stroke={FUI_TOKENS.orbCoreWhite}
              strokeWidth="2"
              strokeDasharray="18 6 4 6"
              opacity="0.85"
            />
          </g>
        </g>

        {/* Geodesic Icosphere Wireframe Edges */}
        <g data-orb-part="edges">
          {mesh.edges.map(([u, v], idx) => {
            const pu = projected[u]!;
            const pv = projected[v]!;
            const depthAlpha = Number(Math.max(0.18, Math.min(0.88, 0.5 + (pu.z2 + pv.z2) * 0.22)).toFixed(2));
            return (
              <line
                key={idx}
                data-orb-edge={idx}
                x1={pu.sx}
                y1={pu.sy}
                x2={pv.sx}
                y2={pv.sy}
                stroke={FUI_TOKENS.accentCyan}
                strokeWidth="1.1"
                opacity={depthAlpha}
              />
            );
          })}
        </g>

        {/* Geodesic Icosphere Vertices & Query Illumination Nodes */}
        <g data-orb-part="vertices">
          {projected.map((pt, idx) => {
            const query = illuminatedMap.get(idx);
            const isIlluminated = Boolean(query);
            return (
              <g
                key={idx}
                data-orb-vertex={idx}
                data-illuminated={isIlluminated ? 'true' : 'false'}
                data-query-source={query?.source}
              >
                {isIlluminated && (
                  <circle
                    cx={pt.sx}
                    cy={pt.sy}
                    r="7.5"
                    fill="none"
                    stroke={query?.source === 'mcp' ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.accentCyan}
                    strokeWidth="1.5"
                  />
                )}
                <circle
                  cx={pt.sx}
                  cy={pt.sy}
                  r={isIlluminated ? 3.6 : 1.9}
                  fill={isIlluminated ? FUI_TOKENS.orbCoreWhite : FUI_TOKENS.accentCyan}
                />
              </g>
            );
          })}
        </g>
      </svg>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          marginTop: '4px',
          fontFamily: FUI_TOKENS.fontMono,
          fontSize: '12px',
          color: FUI_TOKENS.inkMuted,
          borderRadius: '0px',
        }}
      >
        <span>[HIGH_LEVEL_PLAN // {reasoningState.toUpperCase()}]</span>
        <span style={{ color: FUI_TOKENS.accentCyan, fontVariantNumeric: 'tabular-nums' }}>
          NODES:{illuminatedMap.size}/{mesh.vertices.length}
        </span>
      </div>
    </div>
  );
}
