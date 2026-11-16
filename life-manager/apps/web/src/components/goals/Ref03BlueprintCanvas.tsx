import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FuiBadge, FuiPanel, FUI_TOKENS } from '@hermes/ui';
import {
  buildOrthogonalWaypoints,
  clampPercentage,
  formatOrthogonalPathD,
  GOAL_PILLAR_LABELS,
  sanitizeOrthogonalWaypoints,
  type BlueprintLayoutResponse,
  type BlueprintNode,
  type BlueprintPos,
} from './goalsModel';

export interface Ref03BlueprintCanvasProps {
  layout: BlueprintLayoutResponse;
  selectedGoalId?: string | null;
  onSelectGoal?: (goalId: string) => void;
  onPinGoalPosition?: (goalId: string, pos: BlueprintPos) => void;
}

interface DragState {
  nodeId: string;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
}

const BINARY_BORDER_TEXT =
  '01001000 01000101 01010010 01001101 01000101 01010011 // REF-03 ORTHOGONAL ARCHITECTURAL SCHEMATIC // 90-DEG MANHATTAN ROUTING // 01001111 01001011 01010010';

export function Ref03BlueprintCanvas({
  layout,
  selectedGoalId,
  onSelectGoal,
  onPinGoalPosition,
}: Ref03BlueprintCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [pinnedOverrides, setPinnedOverrides] = useState<Record<string, BlueprintPos>>({});
  const [dragState, setDragState] = useState<DragState | null>(null);

  // Reset transient overrides when cycle year changes
  useEffect(() => {
    setPinnedOverrides({});
    setDragState(null);
  }, [layout.year]);

  const effectiveNodes = useMemo<BlueprintNode[]>(() => {
    return layout.nodes.map((node) => {
      if (dragState && dragState.nodeId === node.id) {
        return {
          ...node,
          x: dragState.currentX,
          y: dragState.currentY,
          pinned: true,
        };
      }
      const override = pinnedOverrides[node.id];
      if (override) {
        return {
          ...node,
          x: override.x,
          y: override.y,
          pinned: true,
        };
      }
      return node;
    });
  }, [layout.nodes, dragState, pinnedOverrides]);

  const nodeMap = useMemo(() => {
    return new Map(effectiveNodes.map((n) => [n.id, n]));
  }, [effectiveNodes]);

  const effectiveCorridors = useMemo(() => {
    return layout.corridors.map((corridor, idx) => {
      const fromNode = nodeMap.get(corridor.from_id);
      const toNode = nodeMap.get(corridor.to_id);
      const isEndpointMoved =
        Boolean(dragState && (dragState.nodeId === corridor.from_id || dragState.nodeId === corridor.to_id)) ||
        Boolean(pinnedOverrides[corridor.from_id] || pinnedOverrides[corridor.to_id]);

      if (fromNode && toNode && isEndpointMoved) {
        const fromPt: BlueprintPos = {
          x: Math.round(fromNode.x + fromNode.width),
          y: Math.round(fromNode.y + fromNode.height / 2),
        };
        const toPt: BlueprintPos = {
          x: Math.round(toNode.x),
          y: Math.round(toNode.y + toNode.height / 2),
        };
        const midX = Math.round((fromPt.x + toPt.x) / 2) + ((idx % 3) - 1) * 10;
        const waypoints = buildOrthogonalWaypoints(fromPt, toPt, midX);
        return {
          ...corridor,
          waypoints,
        };
      }

      const fallbackFrom: BlueprintPos = fromNode
        ? { x: Math.round(fromNode.x + fromNode.width), y: Math.round(fromNode.y + fromNode.height / 2) }
        : { x: 266, y: 260 };
      const fallbackTo: BlueprintPos = toNode
        ? { x: Math.round(toNode.x), y: Math.round(toNode.y + toNode.height / 2) }
        : { x: 380, y: 180 };

      return {
        ...corridor,
        waypoints: sanitizeOrthogonalWaypoints(corridor.waypoints, fallbackFrom, fallbackTo),
      };
    });
  }, [layout.corridors, nodeMap, dragState, pinnedOverrides]);

  useEffect(() => {
    if (!dragState) return undefined;

    const toSvgDelta = (clientX: number, clientY: number) => {
      const svgEl = svgRef.current;
      if (!svgEl) {
        return {
          dx: clientX - dragState.startClientX,
          dy: clientY - dragState.startClientY,
        };
      }
      const rect = svgEl.getBoundingClientRect();
      const scaleX = rect.width > 0 ? 1280 / rect.width : 1;
      const scaleY = rect.height > 0 ? 560 / rect.height : 1;
      return {
        dx: (clientX - dragState.startClientX) * scaleX,
        dy: (clientY - dragState.startClientY) * scaleY,
      };
    };

    const handleMove = (ev: MouseEvent | PointerEvent) => {
      const { dx, dy } = toSvgDelta(ev.clientX, ev.clientY);
      const nextX = Math.min(1020, Math.max(40, Math.round(dragState.originX + dx)));
      const nextY = Math.min(440, Math.max(68, Math.round(dragState.originY + dy)));
      setDragState((prev) =>
        prev
          ? {
              ...prev,
              currentX: nextX,
              currentY: nextY,
            }
          : null,
      );
    };

    const handleUp = (ev: MouseEvent | PointerEvent) => {
      const { dx, dy } = toSvgDelta(ev.clientX, ev.clientY);
      const movedDistance = Math.abs(dx) + Math.abs(dy);
      const finalX =
        movedDistance >= 2
          ? Math.min(1020, Math.max(40, Math.round(dragState.originX + dx)))
          : Math.min(1020, Math.max(40, Math.round(dragState.originX + 20)));
      const finalY =
        movedDistance >= 2
          ? Math.min(440, Math.max(68, Math.round(dragState.originY + dy)))
          : Math.min(440, Math.max(68, Math.round(dragState.originY + 20)));

      const finalPos: BlueprintPos = { x: finalX, y: finalY };
      const targetId = dragState.nodeId;
      setPinnedOverrides((prev) => ({
        ...prev,
        [targetId]: finalPos,
      }));
      setDragState(null);
      onPinGoalPosition?.(targetId, finalPos);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragState, onPinGoalPosition]);

  const handleGoalNodeStartDrag = (
    e: React.MouseEvent<SVGGElement> | React.PointerEvent<SVGGElement>,
    node: BlueprintNode,
  ) => {
    e.stopPropagation();
    onSelectGoal?.(node.id);
    setDragState({
      nodeId: node.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: node.x,
      originY: node.y,
      currentX: node.x,
      currentY: node.y,
    });
  };

  return (
    <FuiPanel
      surface="blueprint"
      data-testid="goals-blueprint-panel"
      headerTitle={`REF-03 ARCHITECTURAL BLUEPRINT // CYCLE ${layout.year} // 90° MANHATTAN SCHEMATIC`}
      headerProps={{
        title: `REF-03 ARCHITECTURAL BLUEPRINT // CYCLE ${layout.year} // 90° MANHATTAN SCHEMATIC`,
        code: `BP_${layout.year}`,
        accent: 'vermilion',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          backgroundColor: FUI_TOKENS.bgBlueprint,
          color: FUI_TOKENS.inkStark,
          padding: '8px',
          border: `1px solid ${FUI_TOKENS.borderHairline}`,
          borderRadius: '0px',
        }}
      >
        {/* 8-Bit Binary Periphery Top Border */}
        <div
          data-testid="blueprint-binary-border-top"
          style={{
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            color: FUI_TOKENS.accentCyan,
            backgroundColor: '#0B1015',
            padding: '4px 8px',
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            borderRadius: '0px',
          }}
        >
          {BINARY_BORDER_TEXT}
        </div>

        {/* Top-Left Architectural Title Block + Top-Right Q1-Q4 Matrix Table */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '10px',
            borderRadius: '0px',
          }}
        >
          {/* Architectural Title Block */}
          <div
            data-testid="blueprint-title-block"
            style={{
              backgroundColor: '#0C1218',
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              borderRadius: '0px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ color: FUI_TOKENS.accentOrange, fontWeight: 700 }}>
                TITLE BLOCK // YEAR // {layout.title_block.year}
              </span>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <FuiBadge tone="cyan">{layout.title_block.status.toUpperCase()}</FuiBadge>
                <FuiBadge tone="vermilion">{layout.title_block.revision}</FuiBadge>
              </div>
            </div>
            <div style={{ color: FUI_TOKENS.inkStark, fontWeight: 600 }}>
              THEME // {layout.title_block.theme}
            </div>
            <div style={{ color: FUI_TOKENS.inkMuted }}>
              DAYS ELAPSED // {layout.title_block.days_elapsed} / {layout.title_block.days_total} DAYS · DRAG ANY GOAL ROOM NODE TO PIN SCHEMATIC COORDINATES
            </div>
          </div>

          {/* Top-Right Q1-Q4 Matrix Table */}
          <div
            data-testid="blueprint-quarter-matrix"
            style={{
              backgroundColor: '#0C1218',
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              padding: '10px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              borderRadius: '0px',
            }}
          >
            <div style={{ color: FUI_TOKENS.accentCyan, fontWeight: 700, marginBottom: '6px' }}>
              Q1–Q4 QUARTERLY OKR MATRIX TABLE
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                gap: '6px',
                borderRadius: '0px',
              }}
            >
              {layout.quarter_matrix.map((cell) => {
                const pct = clampPercentage(cell.avg_progress_pct, 0);
                return (
                  <div
                    key={cell.quarter}
                    data-testid={`blueprint-matrix-${cell.quarter}`}
                    style={{
                      border: `1px solid ${FUI_TOKENS.borderHairline}`,
                      padding: '6px',
                      backgroundColor: FUI_TOKENS.bgBlueprint,
                      borderRadius: '0px',
                    }}
                  >
                    <div style={{ color: FUI_TOKENS.accentOrange, fontWeight: 700 }}>
                      {cell.quarter}
                    </div>
                    <div style={{ color: FUI_TOKENS.inkStark }}>{pct}%</div>
                    <div style={{ color: FUI_TOKENS.inkMuted }}>
                      {cell.completed_count}/{cell.kr_count} KRs
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Interactive REF-03 90-Degree Orthogonal SVG Schematic */}
        <svg
          ref={svgRef}
          data-fui-blueprint="true"
          data-testid="goals-blueprint-canvas"
          viewBox="0 0 1280 560"
          style={{
            width: '100%',
            minHeight: '360px',
            height: '440px',
            display: 'block',
            backgroundColor: FUI_TOKENS.bgBlueprint,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            userSelect: 'none',
            borderRadius: '0px',
          }}
        >
          <defs>
            {/* 45-degree hatch strictly inside <defs> so auditOrthogonalBlueprintCorridors skips it */}
            <pattern
              id="ref03-hatch-45"
              width="8"
              height="8"
              patternTransform="rotate(45 0 0)"
              patternUnits="userSpaceOnUse"
            >
              <line x1="0" y1="0" x2="0" y2="8" stroke="#1E293B" strokeWidth="2" />
            </pattern>
          </defs>

          {/* Static Orthogonal Architectural Frame & Quarter Bus Corridors (ensures segmentCount > 0 even when 0 goals exist) */}
          <path
            d="M 20 20 H 1260 V 540 H 20 V 20"
            fill="none"
            stroke="#1E293B"
            strokeWidth="1.5"
          />
          <path d="M 20 56 H 1260" fill="none" stroke="#1E293B" strokeWidth="1" />
          <path
            d="M 310 20 V 540"
            fill="none"
            stroke="#1E293B"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <path
            d="M 680 20 V 540"
            fill="none"
            stroke="#1E293B"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <path
            d="M 980 20 V 540"
            fill="none"
            stroke="#1E293B"
            strokeWidth="1"
            strokeDasharray="4 4"
          />

          {/* Column Axis Headers inside Schematic */}
          <text
            x="40"
            y="42"
            fill={FUI_TOKENS.accentCyan}
            fontFamily={FUI_TOKENS.fontMono}
            fontSize="12"
          >
            ZONE 01 // ANNUAL CYCLE ROOT
          </text>
          <text
            x="330"
            y="42"
            fill={FUI_TOKENS.accentOrange}
            fontFamily={FUI_TOKENS.fontMono}
            fontSize="12"
          >
            ZONE 02 // STRATEGIC GOAL ROOMS (DRAG TO PIN)
          </text>
          <text
            x="700"
            y="42"
            fill={FUI_TOKENS.accentPhosphor}
            fontFamily={FUI_TOKENS.fontMono}
            fontSize="12"
          >
            ZONE 03 // Q1–Q4 KEY RESULT PARTITIONS
          </text>

          {/* Pillar Zone Bands */}
          {layout.pillar_zones.map((zone) => {
            const zy = Math.min(480, Math.max(64, Math.round(zone.zone_y)));
            const zh = Math.min(520 - zy, Math.max(48, Math.round(zone.zone_height)));
            return (
              <g key={`zone-${zone.pillar}`}>
                <rect
                  x="316"
                  y={zy}
                  width="350"
                  height={zh}
                  rx="0"
                  ry="0"
                  fill="none"
                  stroke="#18222C"
                  strokeWidth="1"
                />
                <text
                  x="324"
                  y={zy + 16}
                  fill={FUI_TOKENS.inkMuted}
                  fontFamily={FUI_TOKENS.fontMono}
                  fontSize="11"
                >
                  {zone.label} ({ clampPercentage(zone.avg_progress_pct, 0) }%)
                </text>
              </g>
            );
          })}

          {/* Dynamic 90-Degree Manhattan Corridors */}
          {effectiveCorridors.map((corridor, idx) => {
            const d = formatOrthogonalPathD(corridor.waypoints);
            const isDashed = corridor.style === 'dashed';
            return (
              <path
                key={`corridor-${corridor.from_id}-${corridor.to_id}-${idx}`}
                data-testid={`blueprint-corridor-${idx}`}
                data-corridor-style={corridor.style}
                d={d}
                fill="none"
                stroke={isDashed ? FUI_TOKENS.accentCyan : '#DCE8EE'}
                strokeWidth={isDashed ? '1.75' : '2'}
                strokeDasharray={isDashed ? '6 4' : undefined}
              />
            );
          })}

          {/* Blueprint Nodes (Cycle Root, Goals, and Key Results) */}
          {effectiveNodes.map((node) => {
            const nx = Math.round(node.x);
            const ny = Math.round(node.y);
            const nw = Math.round(node.width);
            const nh = Math.round(node.height);
            const pct = clampPercentage(node.progress_pct, 0);
            const barW = Math.round(((nw - 20) * pct) / 100);

            if (node.node_kind === 'cycle_root') {
              return (
                <g
                  key={node.id}
                  data-testid="blueprint-cycle-root"
                  transform={`translate(${nx}, ${ny})`}
                >
                  <rect
                    x="0"
                    y="0"
                    width={nw}
                    height={nh}
                    rx="0"
                    ry="0"
                    fill="#0C1319"
                    stroke={FUI_TOKENS.accentOrange}
                    strokeWidth="2"
                  />
                  <circle
                    data-fui-beacon="true"
                    cx={nw - 14}
                    cy="14"
                    r="5"
                    fill={FUI_TOKENS.accentVermilion}
                  />
                  <text
                    x="10"
                    y="20"
                    fill={FUI_TOKENS.accentOrange}
                    fontFamily={FUI_TOKENS.fontMono}
                    fontSize="12"
                    fontWeight="700"
                  >
                    CYCLE // {node.code}
                  </text>
                  <text
                    x="10"
                    y="42"
                    fill={FUI_TOKENS.inkStark}
                    fontFamily={FUI_TOKENS.fontMono}
                    fontSize="12"
                  >
                    {node.title.slice(0, 24)}
                  </text>
                  <rect
                    x="10"
                    y={nh - 18}
                    width={nw - 20}
                    height="6"
                    rx="0"
                    ry="0"
                    fill="#1E293B"
                  />
                  <rect
                    x="10"
                    y={nh - 18}
                    width={Math.max(0, barW)}
                    height="6"
                    rx="0"
                    ry="0"
                    fill={FUI_TOKENS.accentOrange}
                  />
                </g>
              );
            }

            if (node.node_kind === 'goal') {
              const isSelected = selectedGoalId === node.id;
              const isCompleted = node.status === 'completed' || pct >= 100;
              const pillarLabel = node.pillar
                ? GOAL_PILLAR_LABELS[node.pillar]
                : 'SYSTEMS // INFRA';

              return (
                <g
                  key={node.id}
                  data-testid={`blueprint-node-${node.id}`}
                  data-goal-id={node.id}
                  data-node-id={node.id}
                  data-id={node.id}
                  transform={`translate(${nx}, ${ny})`}
                  onMouseDown={(e) => handleGoalNodeStartDrag(e, node)}
                  onPointerDown={(e) => handleGoalNodeStartDrag(e, node)}
                  style={{ cursor: 'grab' }}
                >
                  <rect
                    x="0"
                    y="0"
                    width={nw}
                    height={nh}
                    rx="0"
                    ry="0"
                    fill="#0D151C"
                    stroke={
                      isSelected
                        ? FUI_TOKENS.accentOrange
                        : isCompleted
                          ? FUI_TOKENS.accentPhosphor
                          : '#DCE8EE'
                    }
                    strokeWidth={isSelected ? '2.5' : '2'}
                  />
                  {isCompleted && (
                    <rect
                      x="2"
                      y="2"
                      width={nw - 4}
                      height={nh - 4}
                      rx="0"
                      ry="0"
                      fill="url(#ref03-hatch-45)"
                      opacity="0.45"
                    />
                  )}
                  {node.is_north_star_beacon && (
                    <circle
                      data-fui-beacon="true"
                      cx={nw - 14}
                      cy="14"
                      r="5"
                      fill={FUI_TOKENS.accentVermilion}
                    />
                  )}
                  <text
                    x="10"
                    y="19"
                    fill={FUI_TOKENS.accentCyan}
                    fontFamily={FUI_TOKENS.fontMono}
                    fontSize="11"
                    fontWeight="700"
                  >
                    {node.code} // {pillarLabel.split(' // ')[0]} {node.pinned ? '[PINNED]' : ''}
                  </text>
                  <text
                    x="10"
                    y="39"
                    fill={FUI_TOKENS.inkStark}
                    fontFamily={FUI_TOKENS.fontMono}
                    fontSize="12"
                    fontWeight="600"
                  >
                    {node.title.slice(0, 25)}
                  </text>
                  <text
                    x="10"
                    y="57"
                    fill={FUI_TOKENS.inkMuted}
                    fontFamily={FUI_TOKENS.fontMono}
                    fontSize="11"
                  >
                    PROGRESS: {pct}% · X:{nx} Y:{ny}
                  </text>
                  <rect
                    x="10"
                    y={nh - 14}
                    width={nw - 20}
                    height="6"
                    rx="0"
                    ry="0"
                    fill="#1E293B"
                  />
                  <rect
                    x="10"
                    y={nh - 14}
                    width={Math.max(0, barW)}
                    height="6"
                    rx="0"
                    ry="0"
                    fill={
                      isCompleted ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.accentOrange
                    }
                  />
                </g>
              );
            }

            // Key Result node
            return (
              <g
                key={node.id}
                data-testid={`blueprint-kr-${node.id}`}
                data-kr-id={node.id}
                transform={`translate(${nx}, ${ny})`}
              >
                <rect
                  x="0"
                  y="0"
                  width={nw}
                  height={nh}
                  rx="0"
                  ry="0"
                  fill="#0A1016"
                  stroke={pct >= 100 ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.accentCyan}
                  strokeWidth="1.5"
                />
                {node.is_north_star_beacon && (
                  <circle
                    data-fui-beacon="true"
                    cx={nw - 12}
                    cy="12"
                    r="4"
                    fill={FUI_TOKENS.accentVermilion}
                  />
                )}
                <text
                  x="8"
                  y="18"
                  fill={FUI_TOKENS.accentPhosphor}
                  fontFamily={FUI_TOKENS.fontMono}
                  fontSize="11"
                  fontWeight="700"
                >
                  {node.quarter ?? 'Q1'} // {node.code} ({pct}%)
                </text>
                <text
                  x="8"
                  y="36"
                  fill={FUI_TOKENS.inkStark}
                  fontFamily={FUI_TOKENS.fontMono}
                  fontSize="11"
                >
                  {node.title.slice(0, 24)}
                </text>
                <rect
                  x="8"
                  y={nh - 12}
                  width={nw - 16}
                  height="5"
                  rx="0"
                  ry="0"
                  fill="#1E293B"
                />
                <rect
                  x="8"
                  y={nh - 12}
                  width={Math.max(0, Math.round(((nw - 16) * pct) / 100))}
                  height="5"
                  rx="0"
                  ry="0"
                  fill={FUI_TOKENS.accentCyan}
                />
              </g>
            );
          })}
        </svg>

        {/* Bottom-Left KEY Legend & Bottom-Right STRATEGIST NOTES */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '10px',
            borderRadius: '0px',
          }}
        >
          <div
            data-testid="blueprint-key-legend"
            style={{
              backgroundColor: '#0C1218',
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              padding: '10px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              borderRadius: '0px',
            }}
          >
            <div style={{ color: FUI_TOKENS.accentOrange, fontWeight: 700 }}>
              KEY // ARCHITECTURAL SCHEMATIC LEGEND
            </div>
            <div style={{ color: FUI_TOKENS.inkStark }}>
              SOLID WALL (#DCE8EE) = DIRECT OKR CORRIDOR · DASHED PARTITION (#2CE5F2) = CROSS-MODULE LINKED KR
            </div>
            <div style={{ color: FUI_TOKENS.inkMuted }}>
              45° HATCH = COMPLETED ROOM · #EB4511 VERMILION BEACON = NORTH-STAR PRIORITY OBJECTIVE
            </div>
          </div>

          <div
            data-testid="blueprint-strategist-notes"
            style={{
              backgroundColor: '#0C1218',
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              padding: '10px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              borderRadius: '0px',
            }}
          >
            <div style={{ color: FUI_TOKENS.accentCyan, fontWeight: 700 }}>
              STRATEGIST NOTES // VISION & ANTI-GOALS ({layout.year})
            </div>
            <div style={{ color: FUI_TOKENS.inkStark }}>
              VISION: {layout.cycle.vision_md}
            </div>
            <div style={{ color: FUI_TOKENS.accentAmber }}>
              ANTI-GOALS: {layout.cycle.anti_goals_md}
            </div>
          </div>
        </div>

        {/* 8-Bit Binary Periphery Bottom Border */}
        <div
          data-testid="blueprint-binary-border-bottom"
          style={{
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            color: FUI_TOKENS.inkMuted,
            backgroundColor: '#0B1015',
            padding: '4px 8px',
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            borderRadius: '0px',
          }}
        >
          {BINARY_BORDER_TEXT}
        </div>
      </div>
    </FuiPanel>
  );
}
