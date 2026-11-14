import React from 'react';
import { FUI_TOKENS } from '../tokens';

export type BootStage = 1 | 2 | 3;

export const BOOT_STAGE_LABELS: Record<BootStage, string> = {
  1: '[1 // DB_ONLINE]',
  2: '[2 // HERMES_GATEWAY]',
  3: '[3 // READY]',
};

export interface OrbitalBootScreenProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Current Rust subsystem boot stage: 1 -> 2 -> 3 */
  stage: BootStage;
  /** Optional custom status sublabel (e.g. "HERMES_GATEWAY // OFFLINE_MOCK" when :8642 is unreachable) */
  sublabel?: string;
  /** Gateway health indicator shown on Stage 2/3 without blocking boot completion */
  gatewayMode?: 'online' | 'offline_mock';
  /** Renders fixed 100vw x 100vh overlay when true, or embedded container when false; default true */
  fullScreen?: boolean;
}

const DEG = Math.PI / 180;

function polarOrigin(r: number, deg: number): [number, number] {
  const rad = deg * DEG;
  return [Number((r * Math.cos(rad)).toFixed(2)), Number((r * Math.sin(rad)).toFixed(2))];
}

function arcPathOrigin(r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polarOrigin(r, startDeg);
  const [x2, y2] = polarOrigin(r, endDeg);
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweep = endDeg >= startDeg ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2} ${y2}`;
}

export function OrbitalBootScreen({
  stage,
  sublabel,
  gatewayMode = 'online',
  fullScreen = true,
  style,
  ...rest
}: OrbitalBootScreenProps) {
  const safeStage: BootStage = stage === 1 || stage === 2 || stage === 3 ? stage : 1;
  const sweepDeg = safeStage === 1 ? 120 : safeStage === 2 ? 245 : 352;
  const stageLabel = BOOT_STAGE_LABELS[safeStage];

  return (
    <div
      {...rest}
      data-fui="orbital-boot-screen"
      data-boot-stage={safeStage}
      data-gateway-mode={gatewayMode}
      style={{
        position: fullScreen ? 'fixed' : 'relative',
        inset: fullScreen ? 0 : undefined,
        zIndex: fullScreen ? 999 : undefined,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        fontFamily: FUI_TOKENS.fontMono,
        borderRadius: '0px',
        ...style,
      }}
    >
      <svg
        width="560"
        height="420"
        viewBox="0 0 560 420"
        role="img"
        aria-label={`HERMES Boot Sequence ${stageLabel}`}
        style={{ maxWidth: '100%', height: 'auto', borderRadius: '0px' }}
      >
        {/* Oblique 3D-Tilted Astrolabe Plane */}
        <g data-astrolabe-plane="true" transform="translate(248, 212) rotate(-18) scale(1, 0.72)">
          {/* Morse Dash/Dot Outer Ring */}
          <circle
            data-astrolabe-part="morse-ring"
            cx="0"
            cy="0"
            r="176"
            fill="none"
            stroke={FUI_TOKENS.astrolabeGold}
            strokeWidth="2.2"
            strokeDasharray="16 6 3 5 3 8 24 6 4 5 4 10"
          />

          {/* Concentric Swept Progress Arcs */}
          <g data-astrolabe-part="swept-arcs">
            <path
              data-astrolabe-sweep={sweepDeg}
              d={arcPathOrigin(160, 110, 110 + sweepDeg)}
              fill="none"
              stroke={FUI_TOKENS.accentOrange}
              strokeWidth="5.5"
            />
            <path
              d={arcPathOrigin(146, -40, 175)}
              fill="none"
              stroke={FUI_TOKENS.accentVermilion}
              strokeWidth="2"
              opacity="0.85"
            />
            <circle
              cx="0"
              cy="0"
              r="112"
              fill="none"
              stroke={FUI_TOKENS.accentOrange}
              strokeWidth="1.2"
              strokeDasharray="2 6"
              opacity="0.5"
            />
            <circle
              cx="0"
              cy="0"
              r="80"
              fill="none"
              stroke={FUI_TOKENS.accentOrange}
              strokeWidth="1.2"
              strokeDasharray="2 6"
              opacity="0.5"
            />
            <circle cx="0" cy="0" r="38" fill="none" stroke={FUI_TOKENS.accentOrange} strokeWidth="2.5" />
            <circle cx="0" cy="0" r="29" fill="none" stroke={FUI_TOKENS.accentOrange} strokeWidth="2" />
            <circle cx="0" cy="0" r="20" fill="none" stroke={FUI_TOKENS.accentOrange} strokeWidth="1.5" />
          </g>

          {/* Crosshair Spokes & [·] Bracket Reticle */}
          <g data-astrolabe-part="crosshair-spokes">
            <line x1="0" y1="0" x2="-116" y2="0" stroke={FUI_TOKENS.accentOrange} strokeWidth="1.5" />
            <circle cx="-116" cy="0" r="5" fill={FUI_TOKENS.astrolabeGold} />
            {/* [·] Bracket Reticle */}
            <path
              data-astrolabe-part="bracket-reticle"
              d="M -138 -6 H -144 V 6 H -138 M -128 -6 H -122 V 6 H -128"
              fill="none"
              stroke={FUI_TOKENS.astrolabeGold}
              strokeWidth="1.5"
            />
            <circle cx="-133" cy="0" r="1.5" fill={FUI_TOKENS.inkStark} />

            <line x1="0" y1="0" x2="-42" y2="-118" stroke={FUI_TOKENS.accentOrange} strokeWidth="1.2" />
            <line x1="0" y1="0" x2="76" y2="-110" stroke={FUI_TOKENS.accentOrange} strokeWidth="1.2" />
            <line x1="0" y1="0" x2="28" y2="84" stroke={FUI_TOKENS.accentOrange} strokeWidth="1.5" />
            <circle cx="28" cy="84" r="9" fill="none" stroke={FUI_TOKENS.astrolabeGold} strokeWidth="1.5" />
            <circle cx="28" cy="84" r="3.5" fill={FUI_TOKENS.astrolabeGold} />
          </g>
        </g>

        {/* Foreground ◆◆ Overlapping Glowing Diamonds & Chamfered Stage Tag */}
        <g transform="translate(248, 212) rotate(12)">
          <circle cx="0" cy="0" r="9" fill="#FFF7E6" stroke={FUI_TOKENS.astrolabeGold} strokeWidth="3" />

          {/* Overlapping 45° Glowing Diamonds (◆◆) */}
          <g data-astrolabe-part="double-diamond">
            <polygon
              data-diamond="1"
              points="32,-24 56,0 32,24 8,0"
              fill="rgba(248, 124, 24, 0.55)"
              stroke="#FFF3D1"
              strokeWidth="4"
            />
            <polygon
              data-diamond="2"
              points="58,-21 79,0 58,21 37,0"
              fill="rgba(235, 69, 17, 0.38)"
              stroke={FUI_TOKENS.astrolabeGold}
              strokeWidth="3.5"
            />
          </g>

          {/* Chamfered Rightward Stage Tag */}
          <g data-astrolabe-part="stage-tag">
            <polygon
              points="76,-12 90,-22 252,-22 262,-12 262,22 90,22 76,12"
              fill="rgba(19, 21, 26, 0.92)"
              stroke={FUI_TOKENS.accentOrange}
              strokeWidth="1.8"
            />
            <text
              data-boot-stage-numeral={safeStage}
              x="236"
              y="9"
              textAnchor="end"
              fill="#FFF3D1"
              fontFamily={FUI_TOKENS.fontDisplay}
              fontSize="28"
              fontWeight="700"
            >
              {safeStage}
            </text>
          </g>
        </g>
      </svg>

      {/* Accessible Horizontal HUD Readout Bar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          marginTop: '8px',
          borderRadius: '0px',
        }}
      >
        <div
          data-testid="boot-stage-label"
          style={{
            padding: '4px 14px',
            backgroundColor: FUI_TOKENS.bgPanel,
            border: `1px solid ${FUI_TOKENS.accentOrange}`,
            color: FUI_TOKENS.inkStark,
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '13px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            borderRadius: '0px',
          }}
        >
          {stageLabel}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '0px' }}>
          {([1, 2, 3] as const).map((s) => {
            const active = s <= safeStage;
            return (
              <span
                key={s}
                data-boot-step-pill={s}
                data-active={active ? 'true' : 'false'}
                style={{
                  padding: '2px 8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  backgroundColor: active ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgPanel,
                  color: active ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkMuted,
                  border: `1px solid ${active ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline}`,
                  borderRadius: '0px',
                }}
              >
                0{s}
              </span>
            );
          })}
        </div>

        {(sublabel || gatewayMode === 'offline_mock') && (
          <div
            data-testid="boot-sublabel"
            style={{
              fontSize: '12px',
              color: gatewayMode === 'offline_mock' ? FUI_TOKENS.accentAmber : FUI_TOKENS.inkMuted,
              borderRadius: '0px',
            }}
          >
            {sublabel ?? 'HERMES_GATEWAY // OFFLINE_MOCK'}
          </div>
        )}
      </div>
    </div>
  );
}
