import React, { useState } from 'react';
import { FUI_TOKENS, IsometricKnightSprite } from '@hermes/ui';
import type { ArenaZone } from '@hermes/api-client';
import type { KnightAnimState } from '@hermes/ui';
import { ARENA_ZONES, type ComputedKnightTelemetry } from './knightsModel';

export interface IsometricArenaBoardProps {
  knights: ComputedKnightTelemetry[];
  selectedKnightId: string | null;
  activeTurnKnightId: string | null;
  castingKnightId: string | null;
  redeployBusyId: string | null;
  onSelectKnight: (knightId: string) => void;
  onRedeployKnight: (knight: ComputedKnightTelemetry, targetZone: ArenaZone, x: number, y: number) => void;
  onOpenForgeEdit: (knight: ComputedKnightTelemetry) => void;
  onDispatchKnight: (knight: ComputedKnightTelemetry, dryRun: boolean) => void;
}

export function IsometricArenaBoard({
  knights,
  selectedKnightId,
  activeTurnKnightId,
  castingKnightId,
  redeployBusyId,
  onSelectKnight,
  onRedeployKnight,
  onOpenForgeEdit,
  onDispatchKnight,
}: IsometricArenaBoardProps) {
  const [draggedKnightId, setDraggedKnightId] = useState<string | null>(null);
  const [dragOverZone, setDragOverZone] = useState<ArenaZone | null>(null);

  const selectedKnight =
    knights.find((k) => k.id === selectedKnightId) ?? knights[0] ?? null;

  const resolveSpriteState = (k: ComputedKnightTelemetry): KnightAnimState => {
    if (castingKnightId && (castingKnightId === k.id || castingKnightId === k.slug)) return 'cast';
    if (k.zone === 'standby_barracks' || k.isPaused) return 'barracks_rest';
    if (k.isCircuitBroken) return 'alert';
    return 'idle';
  };

  const handleDropOnZone = (
    e: React.DragEvent<HTMLElement>,
    targetZone: ArenaZone,
    targetX?: number,
    targetY?: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverZone(null);
    const droppedId =
      e.dataTransfer?.getData('text/plain') || draggedKnightId || selectedKnight?.id;
    setDraggedKnightId(null);
    if (!droppedId) return;
    const knight = knights.find((k) => k.id === droppedId || k.slug === droppedId);
    if (!knight) return;

    const zoneMeta = ARENA_ZONES.find((z) => z.zone === targetZone);
    const defaultCoord = zoneMeta?.defaultCoords[0] ?? { x: 0, y: 0 };
    const nextX = targetX !== undefined ? targetX : defaultCoord.x;
    const nextY = targetY !== undefined ? targetY : defaultCoord.y;
    onRedeployKnight(knight, targetZone, nextX, nextY);
  };

  return (
    <section
      aria-label="Isometric Tactical RPG Command Arena"
      data-testid="knights-arena"
      data-fui="knight-arena"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '14px',
        backgroundColor: FUI_TOKENS.bgArena,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        borderRadius: '0px',
        overflow: 'hidden',
      }}
    >
      {/* Decorative Isometric 2:1 Tech-Stone Circuit Traces SVG Backdrop (zero transforms on child sprites) */}
      <svg
        aria-hidden="true"
        viewBox="0 0 1200 540"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          opacity: 0.32,
          borderRadius: '0px',
        }}
      >
        <defs>
          <pattern
            id="arena-circuit-grid"
            width="120"
            height="60"
            patternUnits="userSpaceOnUse"
          >
            {/* 2:1 Isometric Diamond Tile Wireframe */}
            <polygon
              points="60,2 118,30 60,58 2,30"
              fill="none"
              stroke="#2CE5F2"
              strokeWidth="0.75"
              strokeOpacity="0.45"
            />
            <line
              x1="0"
              y1="30"
              x2="120"
              y2="30"
              stroke="#262830"
              strokeWidth="0.6"
            />
            <line
              x1="60"
              y1="0"
              x2="60"
              y2="60"
              stroke="#262830"
              strokeWidth="0.6"
            />
          </pattern>
        </defs>
        <rect x="0" y="0" width="1200" height="540" rx={0} ry={0} fill="url(#arena-circuit-grid)" />
        {/* Isometric Tech-Stone Platform Outlines */}
        <polygon
          points="600,18 1160,270 600,522 40,270"
          fill="none"
          stroke="#F87C18"
          strokeWidth="1.5"
          strokeDasharray="8 6"
        />
      </svg>

      {/* Arena Board Header Strip */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
          paddingBottom: '8px',
          borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
          borderRadius: '0px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              padding: '2px 6px',
              backgroundColor: FUI_TOKENS.inkStark,
              color: FUI_TOKENS.bgCarbon,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 700,
              borderRadius: '0px',
            }}
          >
            REF-13 // 2:1 ISO_BOARD
          </span>
          <span
            style={{
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: FUI_TOKENS.inkProse,
            }}
          >
            Drag any Pixel-Art Knight onto a tile zone or click [⇪ DEPLOY SELECTED] to reassign zone &amp; coordinates.
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            color: FUI_TOKENS.accentCream,
          }}
        >
          <span>ARCH-MAGE COMMANDER: FRIEREN (COUNCIL OVERSEER)</span>
          <span>UNITS: {knights.length}</span>
        </div>
      </div>

      {/* 2x2 Tactical Isometric Zone Quadrants */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '12px',
          borderRadius: '0px',
        }}
      >
        {ARENA_ZONES.map((zoneMeta) => {
          const zoneKnights = knights.filter((k) => k.zone === zoneMeta.zone);
          const isHighlighted = dragOverZone === zoneMeta.zone;
          const isStandbyZone = zoneMeta.zone === 'standby_barracks';

          return (
            <div
              key={zoneMeta.zone}
              data-zone={zoneMeta.zone}
              data-testid={`arena-zone-${zoneMeta.zone}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOverZone !== zoneMeta.zone) {
                  setDragOverZone(zoneMeta.zone);
                }
              }}
              onDragLeave={() => {
                if (dragOverZone === zoneMeta.zone) {
                  setDragOverZone(null);
                }
              }}
              onDrop={(e) => handleDropOnZone(e, zoneMeta.zone)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '10px',
                padding: '12px',
                backgroundColor: isHighlighted ? '#1C2038' : 'rgba(19, 21, 26, 0.90)',
                border: `1px solid ${isHighlighted ? zoneMeta.accentHex : FUI_TOKENS.borderHairline}`,
                borderTop: `3px solid ${zoneMeta.accentHex}`,
                minHeight: '230px',
                borderRadius: '0px',
              }}
            >
              {/* Zone Header & 1-Click Deploy Control */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '8px',
                  borderRadius: '0px',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        padding: '1px 5px',
                        backgroundColor: zoneMeta.accentHex,
                        color: FUI_TOKENS.bgCarbon,
                        fontFamily: FUI_TOKENS.fontMono,
                        fontSize: '12px',
                        fontWeight: 700,
                        borderRadius: '0px',
                      }}
                    >
                      {zoneMeta.code}
                    </span>
                    <span
                      style={{
                        fontFamily: FUI_TOKENS.fontDisplay,
                        fontSize: '15px',
                        fontWeight: 700,
                        letterSpacing: '0.05em',
                        color: FUI_TOKENS.inkStark,
                      }}
                    >
                      {zoneMeta.title}
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      color: FUI_TOKENS.inkMuted,
                    }}
                  >
                    {zoneMeta.subtitle} ({zoneKnights.length} stationed)
                  </span>
                </div>

                {selectedKnight && selectedKnight.zone !== zoneMeta.zone && (
                  <button
                    type="button"
                    data-testid={`deploy-to-${zoneMeta.zone}`}
                    disabled={redeployBusyId === selectedKnight.id}
                    onClick={() => {
                      const coord = zoneMeta.defaultCoords[0] ?? { x: 0, y: 0 };
                      onRedeployKnight(selectedKnight, zoneMeta.zone, coord.x, coord.y);
                    }}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: FUI_TOKENS.bgCarbon,
                      border: `1px solid ${zoneMeta.accentHex}`,
                      color: FUI_TOKENS.inkStark,
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      borderRadius: '0px',
                    }}
                  >
                    {isStandbyZone ? '⏸ Park Selected' : '⇪ Deploy Selected'}
                  </button>
                )}
              </div>

              {/* Stationed Pixel-Art Knights on Tech-Stone Tiles */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
                  gap: '10px',
                  alignItems: 'stretch',
                  borderRadius: '0px',
                }}
              >
                {zoneKnights.map((knight) => {
                  const isSelected = selectedKnight?.id === knight.id;
                  const isActiveTurn = activeTurnKnightId === knight.id;
                  const spriteState = resolveSpriteState(knight);

                  return (
                    <div
                      key={knight.id}
                      draggable
                      data-testid={`knight-unit-${knight.slug || knight.id}`}
                      data-knight-id={knight.id}
                      data-knight-slug={knight.slug}
                      data-knight-zone={knight.zone}
                      data-anim-state={spriteState === 'cast' ? 'casting' : spriteState}
                      onDragStart={(e) => {
                        setDraggedKnightId(knight.id);
                        try {
                          e.dataTransfer.setData('text/plain', knight.id);
                          e.dataTransfer.effectAllowed = 'move';
                        } catch {
                          // Ignore in synthetic jsdom events without full dataTransfer
                        }
                      }}
                      onDragEnd={() => {
                        setDraggedKnightId(null);
                        setDragOverZone(null);
                      }}
                      style={{
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '6px',
                        padding: '10px',
                        backgroundColor: isSelected ? '#191D2C' : FUI_TOKENS.bgCarbon,
                        border: `1px solid ${
                          isSelected
                            ? FUI_TOKENS.accentCyan
                            : isActiveTurn
                              ? FUI_TOKENS.accentOrange
                              : FUI_TOKENS.borderHairline
                        }`,
                        borderRadius: '0px',
                      }}
                    >
                      {/* Tile Coordinate & Status Strip */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          width: '100%',
                          gap: '4px',
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                        }}
                      >
                        <span style={{ color: FUI_TOKENS.inkMuted, fontSize: '12px' }}>
                          TILE ({knight.gridX},{knight.gridY})
                        </span>
                        {knight.isCircuitBroken ? (
                          <span
                            data-testid={`circuit-breaker-${knight.slug}`}
                            style={{
                              padding: '0 4px',
                              backgroundColor: FUI_TOKENS.accentVermilion,
                              color: FUI_TOKENS.inkStark,
                              fontWeight: 700,
                              fontSize: '12px',
                              borderRadius: '0px',
                            }}
                          >
                            CIRCUIT_BREAKER
                          </span>
                        ) : knight.isPaused ? (
                          <span
                            style={{
                              padding: '0 4px',
                              backgroundColor: FUI_TOKENS.borderHairline,
                              color: FUI_TOKENS.inkMuted,
                              fontWeight: 700,
                              fontSize: '12px',
                              borderRadius: '0px',
                            }}
                          >
                            PAUSED
                          </span>
                        ) : (
                          <span
                            style={{
                              color: FUI_TOKENS.accentPhosphor,
                              fontWeight: 700,
                              fontSize: '12px',
                            }}
                          >
                            ONLINE
                          </span>
                        )}
                      </div>

                      {/* Isometric Tech-Stone Plinth SVG + Pixel-Art Knight Sprite (exact integer scale=2) */}
                      <div
                        style={{
                          position: 'relative',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          padding: '4px 0',
                          borderRadius: '0px',
                        }}
                      >
                        <IsometricKnightSprite
                          archetype={knight.archetype}
                          state={spriteState}
                          scale={2}
                          name={knight.name}
                          crestColor={knight.crestColor}
                          hpPct={knight.hpPct}
                          epPct={knight.epPct}
                          hasAlert={knight.isCircuitBroken}
                          active={isActiveTurn}
                          selected={isSelected}
                          showHud={true}
                          onClick={() => onSelectKnight(knight.id)}
                          data-testid={`knight-sprite-${knight.slug || knight.id}`}
                        />
                      </div>

                      {/* Numeric HP ($remaining / $budget) & EP (used / max ctx) Readouts */}
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                          width: '100%',
                          padding: '4px 6px',
                          backgroundColor: FUI_TOKENS.bgPanel,
                          border: `1px solid ${FUI_TOKENS.borderHairline}`,
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                          borderRadius: '0px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '4px',
                          }}
                        >
                          <span style={{ color: FUI_TOKENS.accentVermilion, fontWeight: 700, fontSize: '12px' }}>
                            HP
                          </span>
                          <span
                            data-testid={`knight-hp-readout-${knight.slug}`}
                            style={{ color: FUI_TOKENS.inkStark, fontSize: '12px' }}
                          >
                            {knight.hpLabel}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '4px',
                          }}
                        >
                          <span style={{ color: FUI_TOKENS.accentCyan, fontWeight: 700, fontSize: '12px' }}>
                            EP
                          </span>
                          <span
                            data-testid={`knight-ep-readout-${knight.slug}`}
                            style={{ color: FUI_TOKENS.inkProse, fontSize: '12px' }}
                          >
                            {knight.epLabel}
                          </span>
                        </div>
                      </div>

                      {/* Per-Unit Quick Actions */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          width: '100%',
                          gap: '4px',
                          borderRadius: '0px',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectKnight(knight.id)}
                          style={{
                            flex: 1,
                            padding: '4px 6px',
                            backgroundColor: isSelected ? FUI_TOKENS.accentCyan : FUI_TOKENS.bgPanel,
                            color: isSelected ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                            border: `1px solid ${FUI_TOKENS.borderHairline}`,
                            fontFamily: FUI_TOKENS.fontMono,
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            borderRadius: '0px',
                          }}
                        >
                          {isSelected ? 'SELECTED' : 'SELECT'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenForgeEdit(knight)}
                          style={{
                            padding: '4px 6px',
                            backgroundColor: FUI_TOKENS.bgPanel,
                            color: FUI_TOKENS.inkStark,
                            border: `1px solid ${FUI_TOKENS.borderHairline}`,
                            fontFamily: FUI_TOKENS.fontMono,
                            fontSize: '12px',
                            cursor: 'pointer',
                            borderRadius: '0px',
                          }}
                        >
                          ✎ Forge
                        </button>
                        <button
                          type="button"
                          disabled={knight.isPaused || knight.isCircuitBroken}
                          onClick={() => onDispatchKnight(knight, false)}
                          style={{
                            padding: '4px 6px',
                            backgroundColor:
                              knight.isPaused || knight.isCircuitBroken
                                ? FUI_TOKENS.bgCarbon
                                : FUI_TOKENS.accentOrange,
                            color:
                              knight.isPaused || knight.isCircuitBroken
                                ? FUI_TOKENS.inkMuted
                                : FUI_TOKENS.bgCarbon,
                            border: `1px solid ${FUI_TOKENS.borderHairline}`,
                            fontFamily: FUI_TOKENS.fontMono,
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor:
                              knight.isPaused || knight.isCircuitBroken
                                ? 'not-allowed'
                                : 'pointer',
                            borderRadius: '0px',
                          }}
                        >
                          ▶ Run
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Interactive Isometric Tile Coordinate Matrix for Drop / Click Redeployment */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '6px',
                  paddingTop: '6px',
                  borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
                  borderRadius: '0px',
                }}
              >
                <span
                  style={{
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    color: FUI_TOKENS.inkMuted,
                  }}
                >
                  ISO_TILES:
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                  {zoneMeta.defaultCoords.map((coord) => {
                    const occupant = zoneKnights.find(
                      (k) => k.gridX === coord.x && k.gridY === coord.y,
                    );
                    return (
                      <button
                        key={`${zoneMeta.zone}-${coord.x}-${coord.y}`}
                        type="button"
                        data-testid={`deploy-tile-${zoneMeta.zone}-${coord.x}-${coord.y}`}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleDropOnZone(e, zoneMeta.zone, coord.x, coord.y)}
                        onClick={() => {
                          if (occupant) {
                            onSelectKnight(occupant.id);
                          } else if (selectedKnight) {
                            onRedeployKnight(selectedKnight, zoneMeta.zone, coord.x, coord.y);
                          }
                        }}
                        style={{
                          padding: '2px 6px',
                          backgroundColor: occupant ? '#20263A' : FUI_TOKENS.bgCarbon,
                          border: `1px solid ${occupant ? zoneMeta.accentHex : FUI_TOKENS.borderHairline}`,
                          color: occupant ? FUI_TOKENS.inkStark : FUI_TOKENS.inkMuted,
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                          cursor: 'pointer',
                          borderRadius: '0px',
                        }}
                      >
                        ◆ ({coord.x},{coord.y}) {occupant ? `· ${occupant.name.split(' ')[0]}` : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
