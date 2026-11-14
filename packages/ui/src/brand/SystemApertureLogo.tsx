import React from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { FUI_TOKENS } from '../tokens';

export type SystemApertureStatus = 'online' | 'syncing' | 'offline';

export interface SystemApertureLogoProps extends React.SVGProps<SVGSVGElement> {
  /** Pixel width/height of the square SVG (viewBox is locked to "0 0 200 200"); default 40 */
  size?: number;
  /** Backend/uplink health controlling Layer 5 iris (#A8F040 online vs #F59E0B syncing/offline); default 'online' */
  status?: SystemApertureStatus;
  /** Dilates & rotates Layer 4 8-blade mechanical shutter when Hermes or a Knight is thinking; default false */
  isThinking?: boolean;
  /** Accessible title; default 'HERMES // OS System Aperture' */
  title?: string;
}

const CX = 100;
const CY = 100;
const DEG = Math.PI / 180;

function polar(r: number, deg: number): [number, number] {
  const rad = deg * DEG;
  return [
    Number((CX + r * Math.cos(rad)).toFixed(3)),
    Number((CY + r * Math.sin(rad)).toFixed(3)),
  ];
}

function arcPath(r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(r, startDeg);
  const [x2, y2] = polar(r, endDeg);
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweep = endDeg >= startDeg ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2} ${y2}`;
}

const SHROUD_ARCS: ReadonlyArray<[number, number]> = [
  [-72, -14],
  [16, 76],
  [108, 166],
  [196, 254],
];

const RIM_NOTCH_ANGLES = [-42, -30, -18];

export function SystemApertureLogo({
  size = 40,
  status = 'online',
  isThinking = false,
  title = 'HERMES // OS System Aperture',
  style,
  ...rest
}: SystemApertureLogoProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const irisColor = status === 'online' ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.accentAmber;

  // Layer 4 tangent-line camera iris geometry
  const rOut = 50.2;
  const rAp = isThinking ? 29.0 : 24.5;
  const gammaDeg = Math.acos(rAp / rOut) / DEG;
  const rOct = rAp / Math.cos(22.5 * DEG);

  return (
    <svg
      {...rest}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label={title}
      data-fui="system-aperture-logo"
      data-status={status}
      data-thinking={isThinking ? 'true' : 'false'}
      data-reduced-motion={prefersReducedMotion ? 'true' : 'false'}
      style={{
        display: 'inline-block',
        flexShrink: 0,
        borderRadius: '0px',
        ...style,
      }}
    >
      <title>{title}</title>

      {/* Layer 1: #2A323B Broken Gunmetal Outer Reticle */}
      <g data-layer="1" data-layer-name="outer-reticle">
        <circle cx={CX} cy={CY} r="97" fill={FUI_TOKENS.bgCarbon} />
        <circle cx={CX} cy={CY} r="95" fill="none" stroke={FUI_TOKENS.apertureOuterGunmetal} strokeWidth="1.5" />
        {SHROUD_ARCS.map(([sDeg, eDeg], idx) => (
          <path
            key={idx}
            data-reticle-arc={idx}
            d={arcPath(88.5, sDeg, eDeg)}
            fill="none"
            stroke={FUI_TOKENS.apertureOuterGunmetal}
            strokeWidth="5"
            strokeLinecap="butt"
          />
        ))}
        {RIM_NOTCH_ANGLES.map((deg, idx) => {
          const p1 = polar(85, deg - 3);
          const p2 = polar(85, deg + 3);
          const p3 = polar(92, deg + 3);
          const p4 = polar(92, deg - 3);
          return (
            <polygon
              key={idx}
              data-reticle-notch={idx}
              points={`${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]} ${p4[0]},${p4[1]}`}
              fill="#3B4652"
            />
          );
        })}
        <circle
          cx={CX}
          cy={CY}
          r="80.5"
          fill="none"
          stroke={FUI_TOKENS.apertureOuterGunmetal}
          strokeWidth="2"
          strokeDasharray="20 5 6 5"
        />
      </g>

      {/* Layer 2: #8A96A3 24-Fin Angled Turbine Ring */}
      <g data-layer="2" data-layer-name="turbine-ring">
        {Array.from({ length: 24 }).map((_, k) => {
          const baseDeg = k * 15;
          const p1 = polar(63.5, baseDeg);
          const p2 = polar(63.5, baseDeg + 9.5);
          const p3 = polar(75.5, baseDeg + 9.5 + 11);
          const p4 = polar(75.5, baseDeg + 11);
          return (
            <polygon
              key={k}
              data-turbine-fin={k}
              points={`${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]} ${p4[0]},${p4[1]}`}
              fill={FUI_TOKENS.apertureTurbineSilver}
            />
          );
        })}
      </g>

      {/* Layer 3: #F87C18 36-Tooth Industrial Gear Collar */}
      <g data-layer="3" data-layer-name="gear-collar">
        <circle
          cx={CX}
          cy={CY}
          r="56.8"
          fill="none"
          stroke={FUI_TOKENS.apertureGearTrack}
          strokeWidth="11"
        />
        {Array.from({ length: 36 }).map((_, j) => {
          const toothDeg = j * 10;
          const g1 = polar(52.0, toothDeg);
          const g2 = polar(52.0, toothDeg + 7.2);
          const g3 = polar(61.5, toothDeg + 6.8);
          const g4 = polar(61.5, toothDeg + 0.4);
          return (
            <polygon
              key={j}
              data-gear-tooth={j}
              points={`${g1[0]},${g1[1]} ${g2[0]},${g2[1]} ${g3[0]},${g3[1]} ${g4[0]},${g4[1]}`}
              fill={FUI_TOKENS.accentOrange}
            />
          );
        })}
      </g>

      {/* Layer 4: #F6F6F4 8-Blade Interlocking Mechanical Shutter */}
      <g
        data-layer="4"
        data-layer-name="shutter-blades"
        data-thinking={isThinking ? 'true' : 'false'}
        data-aperture-radius={rAp}
        className={isThinking && !prefersReducedMotion ? 'fui-motion-spin' : undefined}
        transform={isThinking ? 'rotate(15 100 100)' : undefined}
        style={
          isThinking && !prefersReducedMotion
            ? {
                transformOrigin: '100px 100px',
                animation: 'fui-spin-cw 12s linear infinite',
              }
            : undefined
        }
      >
        <circle cx={CX} cy={CY} r="51" fill={FUI_TOKENS.bgCarbon} />
        {Array.from({ length: 8 }).map((_, b) => {
          const a0 = b * 45;
          const a1 = (b + 1) * 45;
          const o0 = polar(rOut, a0);
          const o1 = polar(rOut, a1);
          const kb = polar(rOct, a0 - gammaDeg + 22.5);
          const d = `M ${o0[0]} ${o0[1]} A ${rOut} ${rOut} 0 0 1 ${o1[0]} ${o1[1]} L ${kb[0]} ${kb[1]} Z`;
          return (
            <path
              key={b}
              data-shutter-blade={b}
              d={d}
              fill={FUI_TOKENS.inkStark}
              stroke={FUI_TOKENS.bgCarbon}
              strokeWidth="1.8"
              strokeLinejoin="miter"
            />
          );
        })}
      </g>

      {/* Layer 5: #A8F040 Online / #F59E0B Offline-Syncing Iris + Dark Pupil */}
      <g data-layer="5" data-layer-name="status-iris" data-status={status} data-iris-color={irisColor}>
        <circle cx={CX} cy={CY} r="23.5" fill={FUI_TOKENS.bgCarbon} />
        <circle
          data-iris-outer="true"
          cx={CX}
          cy={CY}
          r="20.5"
          fill="none"
          stroke={irisColor}
          strokeWidth="3.5"
        />
        <circle
          data-iris-segmented="true"
          cx={CX}
          cy={CY}
          r="15.0"
          fill="none"
          stroke={irisColor}
          strokeWidth="3.8"
          strokeDasharray="19.5 4.06"
        />
        <circle
          data-iris-pupil="true"
          cx={CX}
          cy={CY}
          r="10.5"
          fill="#13171E"
          stroke={FUI_TOKENS.bgCarbon}
          strokeWidth="1.5"
        />
      </g>
    </svg>
  );
}
