import React from 'react';
import {
  FuiBadge,
  FuiBatteryCapsule,
  FuiButton,
  FUI_TOKENS,
} from '@hermes/ui';
import type {
  ProjectFlowTopologyResponse,
  ProjectItem,
  TaskStatus,
  TodoTask,
} from '../../api/todos';
import {
  computeTaskBatteryProgressPct,
  stageToDefaultStatus,
  synthesizeProjectFlowTopology,
} from './todosModel';

export interface ProjectFlowViewProps {
  tasks: readonly TodoTask[];
  allTasks: readonly TodoTask[];
  apiFlow?: ProjectFlowTopologyResponse | null;
  selectedProject?: ProjectItem | null;
  activeTimerTaskId?: string | null;
  isTimerRunning?: boolean;
  onInspectTask: (task: TodoTask) => void;
  onTransitionStage: (taskId: string, nextStatus: TaskStatus) => void;
  onToggleTimer: (task: TodoTask) => void;
}

export function ProjectFlowView({
  tasks,
  allTasks,
  apiFlow,
  selectedProject,
  activeTimerTaskId,
  isTimerRunning = false,
  onInspectTask,
  onTransitionStage,
  onToggleTimer,
}: ProjectFlowViewProps) {
  const flowModel = synthesizeProjectFlowTopology(
    tasks,
    apiFlow,
    selectedProject,
    allTasks,
  );

  const taskById = new Map<string, TodoTask>();
  for (const t of allTasks) {
    taskById.set(t.id, t);
  }
  for (const t of tasks) {
    taskById.set(t.id, t);
  }

  const maxNodesInStage = Math.max(
    2,
    ...flowModel.stageColumns.map((c) => c.nodes.length),
  );
  const svgHeight = Math.max(280, maxNodesInStage * 78 + 80);

  return (
    <div
      data-testid="project-flow-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        width: '100%',
        minWidth: 0,
        borderRadius: '0px',
      }}
    >
      {/* Top Telemetry Legend for TERMINAL-I/O Topology (REF-04) */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '8px 12px',
          backgroundColor: FUI_TOKENS.bgCarbon,
          border: `1px solid ${FUI_TOKENS.borderHairline}`,
          fontFamily: FUI_TOKENS.fontMono,
          fontSize: '12px',
          borderRadius: '0px',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', borderRadius: '0px' }}>
          <FuiBadge tone="cyan" code="REF-04">
            TERMINAL - I/O FLOW TOPOLOGY
          </FuiBadge>
          <span style={{ color: FUI_TOKENS.inkStark, fontWeight: 700 }}>
            {flowModel.hubNode.title}
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', borderRadius: '0px' }}>
          <FuiBadge tone="cyan">
            CRITICAL PATH ({flowModel.criticalCount})
          </FuiBadge>
          <FuiBadge tone="vermilion" solid={flowModel.blockedCount > 0}>
            BLOCKED BOTTLENECKS ({flowModel.blockedCount})
          </FuiBadge>
          <FuiBadge tone="phosphor">
            STAGE 04 DONE ({flowModel.stageColumns[3].nodes.length})
          </FuiBadge>
        </div>
      </div>

      {/* Interactive REF-04 SVG Radial Hub + Cubic Bezier S-Curve Schematic */}
      <div
        style={{
          width: '100%',
          overflowX: 'hidden',
          backgroundColor: FUI_TOKENS.bgCarbon,
          border: `1px solid ${FUI_TOKENS.borderHairline}`,
          padding: '8px',
          borderRadius: '0px',
        }}
      >
        <svg
          data-testid="project-flow-svg"
          data-fui-chart="project-flow"
          width="100%"
          height={svgHeight}
          viewBox={`0 0 1140 ${svgHeight}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label="REF-04 TERMINAL-I/O Radial Hub and Stage 01..04 Bezier Flow Topology"
          style={{ display: 'block', width: '100%', borderRadius: '0px' }}
        >
          {/* Stage column vertical hairlines & header banners */}
          {flowModel.stageColumns.map((col) => (
            <g key={col.code}>
              <line
                x1={col.x}
                y1="38"
                x2={col.x}
                y2={svgHeight - 20}
                stroke={FUI_TOKENS.borderHairline}
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <rect
                x={col.x - 84}
                y="8"
                width="168"
                height="24"
                rx="0"
                ry="0"
                fill={FUI_TOKENS.bgPanel}
                stroke={FUI_TOKENS.borderHairline}
                strokeWidth="1"
              />
              <text
                x={col.x}
                y="24"
                textAnchor="middle"
                fill={FUI_TOKENS.inkStark}
                fontFamily={FUI_TOKENS.fontMono}
                fontSize="11"
                fontWeight="700"
              >
                {col.label}
              </text>
            </g>
          ))}

          {/* Cubic Bezier S-Curve Connectors (hub_to_stage, dependency, subtask) */}
          {flowModel.bezierEdges.map((edge) => (
            <g key={edge.id} data-testid={`flow-edge-${edge.id}`}>
              <path
                d={edge.pathD}
                fill="none"
                stroke={edge.color}
                strokeWidth={edge.isBlocked || edge.isCriticalPath ? '2' : '1.4'}
                strokeDasharray={edge.edgeType === 'subtask' ? '4 2' : undefined}
              />
              <circle cx={edge.x1} cy={edge.y1} r="3" fill={edge.color} />
              <circle cx={edge.x2} cy={edge.y2} r="3.5" fill={edge.color} />
            </g>
          ))}

          {/* Left Radial Project Hub (CENTRAL ATRIUM, stage = 0) */}
          <g
            data-testid="project-flow-radial-hub"
            transform={`translate(${flowModel.hubNode.x}, ${flowModel.hubNode.y})`}
          >
            <circle
              cx="0"
              cy="0"
              r="52"
              fill={FUI_TOKENS.bgPanel}
              stroke={FUI_TOKENS.accentCyan}
              strokeWidth="1.5"
            />
            <circle
              cx="0"
              cy="0"
              r="40"
              fill="none"
              stroke={FUI_TOKENS.accentOrange}
              strokeWidth="1"
              strokeDasharray="4 3"
            />
            <circle
              cx="0"
              cy="0"
              r="24"
              fill={FUI_TOKENS.bgCarbon}
              stroke={FUI_TOKENS.inkStark}
              strokeWidth="1.2"
            />
            {/* Radial tick marks */}
            {Array.from({ length: 12 }).map((_, i) => {
              const angle = (i * 30 * Math.PI) / 180;
              const x1 = Number((Math.cos(angle) * 44).toFixed(1));
              const y1 = Number((Math.sin(angle) * 44).toFixed(1));
              const x2 = Number((Math.cos(angle) * 51).toFixed(1));
              const y2 = Number((Math.sin(angle) * 51).toFixed(1));
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={FUI_TOKENS.accentCyan}
                  strokeWidth="1.2"
                />
              );
            })}
            <text
              x="0"
              y="-3"
              textAnchor="middle"
              fill={FUI_TOKENS.accentCyan}
              fontFamily={FUI_TOKENS.fontMono}
              fontSize="9"
              fontWeight="700"
            >
              ATRIUM
            </text>
            <text
              x="0"
              y="9"
              textAnchor="middle"
              fill={FUI_TOKENS.inkStark}
              fontFamily={FUI_TOKENS.fontMono}
              fontSize="8"
            >
              HUB // 00
            </text>
          </g>

          {/* Stage Task Nodes in SVG */}
          {flowModel.nodes.map((node) => (
            <g
              key={node.id}
              data-testid={`flow-svg-node-${node.id}`}
              transform={`translate(${node.x - 64}, ${node.y - 20})`}
            >
              <rect
                x="0"
                y="0"
                width="128"
                height="40"
                rx="0"
                ry="0"
                fill={
                  node.is_blocked
                    ? '#2A0D08'
                    : node.is_critical_path
                      ? '#092229'
                      : FUI_TOKENS.bgPanel
                }
                stroke={node.color}
                strokeWidth={node.is_blocked || node.is_critical_path ? '1.8' : '1.2'}
              />
              <circle cx="10" cy="12" r="3" fill={node.color} />
              <text
                x="18"
                y="15"
                fill={FUI_TOKENS.inkStark}
                fontFamily={FUI_TOKENS.fontMono}
                fontSize="10"
                fontWeight="700"
              >
                {node.title.slice(0, 14)}
              </text>
              <text
                x="10"
                y="31"
                fill={node.is_blocked ? FUI_TOKENS.accentVermilion : FUI_TOKENS.inkMuted}
                fontFamily={FUI_TOKENS.fontMono}
                fontSize="9"
              >
                {node.is_blocked
                  ? 'BLOCKED'
                  : node.is_critical_path
                    ? 'CRITICAL'
                    : node.status.toUpperCase()}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* 4 Stage Columns (STAGE // 01 BACKLOG .. STAGE // 04 DONE) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '10px',
          width: '100%',
          minWidth: 0,
          borderRadius: '0px',
        }}
      >
        {flowModel.stageColumns.map((col) => (
          <div
            key={col.code}
            data-testid={`flow-stage-column-${col.stage}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '10px',
              backgroundColor: FUI_TOKENS.bgPanel,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              minWidth: 0,
              borderRadius: '0px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px',
                paddingBottom: '6px',
                borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              <span style={{ fontWeight: 700, color: FUI_TOKENS.inkStark }}>
                {col.label}
              </span>
              <FuiBadge tone={col.stage === 4 ? 'phosphor' : col.stage === 2 ? 'cyan' : 'orange'}>
                {col.nodes.length} • {col.totalEstimatedMinutes}M
              </FuiBadge>
            </div>

            {col.nodes.length === 0 ? (
              <div
                style={{
                  padding: '12px 8px',
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  color: FUI_TOKENS.inkMuted,
                  border: `1px dashed ${FUI_TOKENS.borderHairline}`,
                  borderRadius: '0px',
                }}
              >
                NO NODES IN {col.code}
              </div>
            ) : (
              col.nodes.map((node) => {
                const task = taskById.get(node.id);
                const isRunningForTask = Boolean(
                  isTimerRunning && activeTimerTaskId && String(activeTimerTaskId) === String(node.id),
                );
                const progressPct = task ? computeTaskBatteryProgressPct(task) : 50;

                return (
                  <div
                    key={node.id}
                    data-testid={`flow-node-card-${node.id}`}
                    data-blocked={node.is_blocked ? 'true' : 'false'}
                    data-critical={node.is_critical_path ? 'true' : 'false'}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      padding: '8px',
                      backgroundColor: FUI_TOKENS.bgCarbon,
                      border: `1px solid ${node.color}`,
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
                        gap: '6px',
                        borderRadius: '0px',
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          color: FUI_TOKENS.inkStark,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {node.title}
                      </span>
                      {node.is_blocked ? (
                        <FuiBadge tone="vermilion" solid>
                          BLOCKED
                        </FuiBadge>
                      ) : node.is_critical_path ? (
                        <FuiBadge tone="cyan">CRITICAL</FuiBadge>
                      ) : (
                        <FuiBadge tone="muted">{node.status}</FuiBadge>
                      )}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '6px',
                        borderRadius: '0px',
                      }}
                    >
                      <FuiBatteryCapsule
                        progressPct={progressPct}
                        segments={4}
                        fillColor={node.color}
                        isPlaying={isRunningForTask}
                        playAriaLabel={`Start focus timer for ${node.title}`}
                        onTriggerPlay={() => {
                          if (task) onToggleTimer(task);
                        }}
                      />

                      <div style={{ display: 'flex', gap: '4px', borderRadius: '0px' }}>
                        {col.stage > 1 && (
                          <FuiButton
                            variant="ghost"
                            size="sm"
                            aria-label={`Move ${node.title} to previous stage`}
                            onClick={() =>
                              onTransitionStage(
                                node.id,
                                stageToDefaultStatus((col.stage - 1) as 1 | 2 | 3 | 4),
                              )
                            }
                          >
                            ←
                          </FuiButton>
                        )}
                        {col.stage < 4 && (
                          <FuiButton
                            data-testid={`flow-advance-btn-${node.id}`}
                            variant="secondary"
                            size="sm"
                            aria-label={`Advance ${node.title} to next stage`}
                            onClick={() =>
                              onTransitionStage(
                                node.id,
                                stageToDefaultStatus((col.stage + 1) as 1 | 2 | 3 | 4),
                              )
                            }
                          >
                            STAGE →
                          </FuiButton>
                        )}
                        {task && (
                          <FuiButton
                            variant="ghost"
                            size="sm"
                            onClick={() => onInspectTask(task)}
                          >
                            EDIT
                          </FuiButton>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ))}
      </div>

      {/* Bottom Throughput Dot-Track (REF-04 Rule 4) */}
      <div
        data-testid="flow-throughput-track"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          padding: '6px 12px',
          backgroundColor: FUI_TOKENS.bgCarbon,
          border: `1px solid ${FUI_TOKENS.borderHairline}`,
          fontFamily: FUI_TOKENS.fontMono,
          fontSize: '12px',
          borderRadius: '0px',
        }}
      >
        <span style={{ color: FUI_TOKENS.inkMuted }}>
          THROUGHPUT DOT-TRACK // TERMINAL-I/O TELEMETRY
        </span>
        <svg
          data-fui-chart="flow-throughput"
          width="240"
          height="12"
          viewBox="0 0 240 12"
          aria-label="Throughput dot track"
          style={{ display: 'block', borderRadius: '0px' }}
        >
          {flowModel.throughputDots.map((dot) => (
            <rect
              key={dot.index}
              x={dot.index * 10 + 1}
              y="2"
              width="6"
              height="8"
              rx="0"
              ry="0"
              fill={dot.color}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
