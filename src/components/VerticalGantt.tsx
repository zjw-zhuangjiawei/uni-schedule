import React, { useMemo, useState } from "react";
import styled from "@emotion/styled";
import { toDate, getDayIndex, getDurationDays, clampDays } from "../utils";
import { COLORS } from "../utils";
import type { GanttTask, DateRange } from "../types";

interface VerticalGanttProps {
  tasks: GanttTask[];
  /** Pixel height per unit (day in legacy discrete mode; per unit in continuous mode) */
  rowHeight?: number;
  dateColumnWidth?: number; // px (first column after removal of legacy task label column)
  taskColumnWidth?: number; // px per lane column
  range?: DateRange; // optional explicit time range to display
  /** Maximum number of lane columns allocated per level (overflow tasks go into a pill). Default 6 */
  maxLanesPerLevel?: number;
  /** If true, show duration inside bar (unit depends on mode) for debugging */
  debugDurations?: boolean;
  /** Base time unit for the vertical axis (default day). */
  timeUnit?: "second" | "minute" | "hour" | "day";
  /** Step multiplier of the chosen timeUnit (e.g. 5 seconds). Default 1. */
  unitStep?: number;
  /** Threshold (#units) above which we automatically switch to continuous positioning to avoid huge DOM (default 5000). */
  maxUnitsBeforeContinuous?: number;
  /** Force continuous mode regardless of threshold / timeUnit. */
  forceContinuous?: boolean;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const VerticalGantt: React.FC<VerticalGanttProps> = ({
  tasks,
  rowHeight = 28,
  dateColumnWidth = 120,
  taskColumnWidth = 140,
  range,
  maxLanesPerLevel = 6,
  debugDurations = false,
  timeUnit = "day",
  unitStep = 1,
  maxUnitsBeforeContinuous = 5000,
  forceContinuous = false,
}: VerticalGanttProps) => {
  const parsedTasks = useMemo(
    () =>
      tasks.map((task) => ({
        ...task,
        start: toDate(task.start),
        end: toDate(task.end),
      })),
    [tasks],
  );

  // ---------------------------------------------------------------------------
  // Time calculations (supporting multiple units + continuous fallback)
  // ---------------------------------------------------------------------------
  const timeCalculations = useMemo(() => {
    // Unit -> ms mapping (months not supported intentionally in this component)
    const UNIT_MS_MAP: Record<string, number> = {
      second: 1000,
      minute: 60 * 1000,
      hour: 60 * 60 * 1000,
      day: MS_PER_DAY,
    };
    const unitMs = UNIT_MS_MAP[timeUnit] ?? MS_PER_DAY;

    if (parsedTasks.length === 0) {
      const now = new Date();
      const fallbackEnd = new Date(now.getTime() + unitMs * unitStep);
      return {
        minStart: now,
        maxEnd: fallbackEnd,
        unitMs,
        totalUnits: 1,
        totalDays: 1, // legacy compatibility
      };
    }

    const tasksMinStart = new Date(
      Math.min(...parsedTasks.map((t) => t.start.getTime())),
    );
    const tasksMaxEnd = new Date(
      Math.max(...parsedTasks.map((t) => t.end.getTime())),
    );

    const rangeStart = range ? toDate(range.start) : undefined;
    const rangeEnd = range ? toDate(range.end) : undefined;
    const minStart = rangeStart ?? tasksMinStart;
    const maxEnd = rangeEnd ?? tasksMaxEnd;

    const spanMs = Math.max(0, maxEnd.getTime() - minStart.getTime());
    const rawUnits = spanMs / (unitMs * unitStep);
    const totalUnits = Math.max(1, Math.ceil(rawUnits) + 1); // include end boundary
    const totalDays =
      clampDays((maxEnd.getTime() - minStart.getTime()) / MS_PER_DAY) + 1; // used for legacy day grid

    return { minStart, maxEnd, unitMs, totalUnits, totalDays };
  }, [parsedTasks, range, timeUnit, unitStep]);

  const { minStart, unitMs, totalUnits, totalDays } = timeCalculations;

  // Decide whether to use continuous mode
  const continuousMode = useMemo(() => {
    if (forceContinuous) return true;
    // If not day unit -> use continuous for finer granularity
    if (timeUnit !== "day") return true;
    // Fallback to discrete day rows if small enough
    return totalUnits > maxUnitsBeforeContinuous;
  }, [forceContinuous, timeUnit, totalUnits, maxUnitsBeforeContinuous]);

  // In continuous mode: pixels per (unitMs * unitStep). We start with rowHeight as px per unit.
  const timelineMetrics = useMemo(() => {
    if (!continuousMode) return null;
    const pxPerUnit = rowHeight; // maintain semantic: rowHeight ~ unit height
    const rawHeight = totalUnits * pxPerUnit;
    const MAX_HEIGHT = 150000; // safety cap to avoid enormous DOM scroll surfaces
    let scale = 1;
    let timelineHeight = rawHeight;
    if (rawHeight > MAX_HEIGHT) {
      scale = MAX_HEIGHT / rawHeight;
      timelineHeight = MAX_HEIGHT;
    }
    const effectivePxPerUnit = pxPerUnit * scale;
    const pxPerMs = effectivePxPerUnit / (unitMs * unitStep);
    return { pxPerUnit: effectivePxPerUnit, pxPerMs, timelineHeight, scale };
  }, [continuousMode, rowHeight, totalUnits, unitMs, unitStep]);
  // ---------------------------------------------------------------------------
  // Lane assignment & overflow handling (per level) based on duration priority
  // ---------------------------------------------------------------------------
  interface InternalTask extends GanttTask {
    start: Date;
    end: Date;
    durationDays: number;
    level: number; // ensure concrete
  }

  // Normalize tasks -> ensure level (fallback 0), compute durationDays
  const tasksWithMeta: InternalTask[] = useMemo(() => {
    return parsedTasks.map((t) => ({
      ...t,
      level: typeof t.level === "number" ? t.level : 0,
      durationDays: Math.max(
        1,
        getDurationDays(new Date(t.start), new Date(t.end)),
      ),
    }));
  }, [parsedTasks]);

  // Group tasks by level
  const levels = useMemo(() => {
    const map = new Map<number, InternalTask[]>();
    for (const task of tasksWithMeta) {
      if (!map.has(task.level)) map.set(task.level, []);
      map.get(task.level)!.push(task);
    }
    // sort tasks inside each level by start for deterministic ordering (secondary)
    for (const [, arr] of map) {
      arr.sort((a, b) => a.start.getTime() - b.start.getTime());
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]); // ascending level
  }, [tasksWithMeta]);

  type LaneAssignment = {
    level: number;
    lanes: { endTime: number }[]; // only tracking end time for greedy placement
    assigned: Map<string, number>; // taskId -> laneIndex
    overflow: InternalTask[];
  };

  const laneAssignments: LaneAssignment[] = useMemo(() => {
    const result: LaneAssignment[] = [];
    for (const [level, levelTasks] of levels) {
      // priority sort: duration desc, start asc (tie) then id
      const sorted = levelTasks.slice().sort((a, b) => {
        // optional explicit priority override (higher first)
        const pa = typeof a.priority === "number" ? a.priority : 0;
        const pb = typeof b.priority === "number" ? b.priority : 0;
        if (pb !== pa) return pb - pa;
        if (b.durationDays !== a.durationDays)
          return b.durationDays - a.durationDays;
        if (a.start.getTime() !== b.start.getTime())
          return a.start.getTime() - b.start.getTime();
        return a.id.localeCompare(b.id);
      });

      const lanes: { endTime: number }[] = [];
      const assigned = new Map<string, number>();
      const overflow: InternalTask[] = [];

      for (const task of sorted) {
        let placed = false;
        for (let i = 0; i < lanes.length; i++) {
          if (lanes[i].endTime <= task.start.getTime()) {
            // place task in this existing lane
            lanes[i].endTime = task.end.getTime();
            assigned.set(task.id, i);
            placed = true;
            break;
          }
        }
        if (!placed) {
          if (lanes.length < maxLanesPerLevel) {
            lanes.push({ endTime: task.end.getTime() });
            assigned.set(task.id, lanes.length - 1);
          } else {
            overflow.push(task);
          }
        }
      }
      result.push({ level, lanes, assigned, overflow });
    }
    return result;
  }, [levels, maxLanesPerLevel]);

  // For the new layout each level occupies a single column. Lanes become sublanes
  // inside that column and are positioned horizontally by percentage.
  const levelsCount = laneAssignments.length;
  const levelIndexMap = useMemo(() => {
    const m = new Map<number, number>();
    laneAssignments.forEach((la, idx) => m.set(la.level, idx));
    return m;
  }, [laneAssignments]);

  const lanesCountMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const la of laneAssignments) m.set(la.level, la.lanes.length);
    return m;
  }, [laneAssignments]);

  const gridTemplateColumns = `${dateColumnWidth}px repeat(${levelsCount}, ${taskColumnWidth}px)`;

  // Flatten for rendering bars quickly
  const allAssignedTasks = useMemo(() => {
    const arr: Array<{ task: InternalTask; laneIndex: number; level: number }> =
      [];
    for (const la of laneAssignments) {
      for (const t of tasksWithMeta) {
        if (t.level !== la.level) continue;
        const laneIndex = la.assigned.get(t.id);
        if (laneIndex != null) {
          arr.push({ task: t, laneIndex, level: la.level });
        }
      }
    }
    return arr;
  }, [laneAssignments, tasksWithMeta]);

  // Simple popover state for overflow (one at a time). Key = `${level}`
  const [openOverflow, setOpenOverflow] = useState<number | null>(null);
  const isEmpty = parsedTasks.length === 0;

  // ---------------------------------------------------------------------------
  // Rendering helpers for continuous mode (tick labels)
  // ---------------------------------------------------------------------------
  const tickData = useMemo(() => {
    if (!continuousMode) return null;
    if (!timelineMetrics) return null;
    // Choose label interval adaptively
    const u = totalUnits;
    const pickInterval = () => {
      if (u <= 120) return 1;
      if (u <= 300) return 5;
      if (u <= 600) return 10;
      if (u <= 1800) return 30; // 30 units
      if (u <= 3600) return 60; // 1 min if second unit
      if (u <= 14400) return 300; // 5 min
      if (u <= 86400) return 3600; // 1 hour
      return 21600; // 6 hours or 6 days depending on unit
    };
    const intervalUnits = pickInterval();
    const maxTicks = 400; // safety
    const ticks: Array<{ unitIndex: number; top: number; label: string }> = [];
    for (
      let i = 0;
      i < totalUnits && ticks.length < maxTicks;
      i += intervalUnits
    ) {
      const date = new Date(minStart.getTime() + i * unitMs * unitStep);
      let label: string;
      if (timeUnit === "second") {
        label = date.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      } else if (timeUnit === "minute" || timeUnit === "hour") {
        label = date.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      } else {
        // day
        label = date.toLocaleDateString();
      }
      const top = rowHeight + i * timelineMetrics.pxPerUnit; // offset by header
      ticks.push({ unitIndex: i, top, label });
    }
    return { ticks, intervalUnits };
  }, [
    continuousMode,
    timelineMetrics,
    totalUnits,
    minStart,
    timeUnit,
    unitMs,
    unitStep,
    rowHeight,
  ]);

  return (
    <Wrapper>
      {isEmpty ? (
        <Inner>
          <EmptyState>
            <EmptyStateText>No tasks to display</EmptyStateText>
            <EmptyStateSubtext>
              Add some schedules using the debug panel
            </EmptyStateSubtext>
          </EmptyState>
        </Inner>
      ) : (
        <Inner
          style={{
            gridTemplateColumns,
            gridTemplateRows: continuousMode
              ? `${rowHeight}px ${timelineMetrics?.timelineHeight || 0}px`
              : `${rowHeight}px repeat(${totalDays}, ${rowHeight}px)`,
          }}
        >
          {/* Header: Date / Axis label */}
          <HeaderLabel style={{ gridColumn: "1 / 2", gridRow: "1 / 2" }}>
            {continuousMode ? "Time" : "Date"}
          </HeaderLabel>
          {laneAssignments.map((la) => {
            const levelIdx = levelIndexMap.get(la.level)!;
            const colStart = 2 + levelIdx;
            return (
              <HeaderLabel
                key={`hdr-${la.level}`}
                style={{
                  gridColumn: `${colStart} / ${colStart + 1}`,
                  gridRow: "1 / 2",
                }}
                title={`Level ${la.level} (${la.lanes.length} lanes)`}
              >
                L{la.level} ({la.lanes.length})
              </HeaderLabel>
            );
          })}

          {/* Discrete day grid mode */}
          {!continuousMode && (
            <>
              {Array.from({ length: totalDays }).map((_, dayIndex) => {
                const currentDate = new Date(
                  minStart.getTime() + dayIndex * MS_PER_DAY,
                );
                const dateLabel = currentDate.toLocaleDateString();
                return (
                  <React.Fragment key={`row-${dayIndex}`}>
                    <DateCell
                      style={{
                        gridColumn: "1 / 2",
                        gridRow: `${dayIndex + 2} / ${dayIndex + 3}`,
                      }}
                    >
                      {dateLabel}
                    </DateCell>
                    {laneAssignments.map((la) => {
                      const levelIdx = levelIndexMap.get(la.level)!;
                      const colStart = 2 + levelIdx;
                      return (
                        <GridCell
                          key={`cell-${dayIndex}-${la.level}`}
                          style={{
                            gridColumn: `${colStart} / ${colStart + 1}`,
                            gridRow: `${dayIndex + 2} / ${dayIndex + 3}`,
                          }}
                        />
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </>
          )}

          {/* Continuous axis (ticks) */}
          {continuousMode && tickData && (
            <AxisColumn style={{ gridColumn: "1 / 2", gridRow: "2 / 3" }}>
              {tickData.ticks.map((t) => (
                <Tick key={`tick-${t.unitIndex}`} style={{ top: t.top }}>
                  <TickLine />
                  <TickLabel>{t.label}</TickLabel>
                </Tick>
              ))}
              {/* scale notice */}
              {timelineMetrics && timelineMetrics.scale !== 1 && (
                <ScaleNotice title="Timeline scaled vertically to fit height cap">
                  Scaled x{timelineMetrics.scale.toFixed(2)}
                </ScaleNotice>
              )}
            </AxisColumn>
          )}

          {/* Bars (shared logic) */}
          {allAssignedTasks.map(({ task, laneIndex, level }) => {
            const levelIdx = levelIndexMap.get(level)!;
            const colStart = 2 + levelIdx;
            const lanesInLevel = Math.max(1, lanesCountMap.get(level) || 1);
            const sublanePct = 100 / lanesInLevel;
            const leftPct = laneIndex * sublanePct;
            const widthCalc = `calc(${sublanePct}% - 16px)`; // subtract horizontal paddings

            let top: number;
            let height: number;
            let durationUnits: number;
            if (!continuousMode) {
              const startIdx = getDayIndex(new Date(task.start), minStart);
              durationUnits = Math.max(
                1,
                getDurationDays(new Date(task.start), new Date(task.end)),
              );
              const headerOffset = rowHeight;
              top = headerOffset + startIdx * rowHeight + 2; // +2 inset
              height = durationUnits * rowHeight - 4;
            } else {
              const startMs = task.start.getTime();
              const endMs = task.end.getTime();
              const spanMs = Math.max(endMs - startMs, unitMs * unitStep); // at least one unit
              durationUnits = Math.max(1, spanMs / (unitMs * unitStep));
              const headerOffset = rowHeight;
              const pxPerMs = timelineMetrics!.pxPerMs;
              top = headerOffset + (startMs - minStart.getTime()) * pxPerMs + 2;
              height = Math.max(4, spanMs * pxPerMs - 4);
            }

            return (
              <BarContainer
                key={`bar-${task.id}`}
                style={{
                  gridColumn: `${colStart} / ${colStart + 1}`,
                  gridRow: continuousMode ? "1 / 3" : `1 / ${totalDays + 2}`,
                }}
              >
                <Bar
                  title={`${task.title}: ${task.start.toString()} → ${task.end.toString()} (duration: ${durationUnits.toFixed(2)} ${timeUnit}${durationUnits > 1 ? "s" : ""})`}
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                    backgroundColor: task.color || COLORS.primary,
                    left: `${leftPct}%`,
                    width: widthCalc,
                  }}
                >
                  <BarText>
                    {task.title}
                    {debugDurations && (
                      <DurationBadge>
                        {continuousMode
                          ? `${durationUnits.toFixed(1)}u`
                          : `${Math.round(durationUnits)}d`}
                      </DurationBadge>
                    )}
                  </BarText>
                </Bar>
              </BarContainer>
            );
          })}

          {/* Overflow pills (unchanged logic; spans full height of column). */}
          {laneAssignments.map((la) => {
            if (!la.overflow.length) return null;
            const levelIdx = levelIndexMap.get(la.level)!;
            const colStart = 2 + levelIdx;
            return (
              <OverflowContainer
                key={`overflow-${la.level}`}
                style={{
                  gridColumn: `${colStart} / ${colStart + 1}`,
                  gridRow: continuousMode ? "1 / 3" : `1 / ${totalDays + 2}`,
                }}
              >
                <OverflowPill
                  role="button"
                  aria-label={`${la.overflow.length} more tasks in level ${la.level}`}
                  onClick={() =>
                    setOpenOverflow((prev) =>
                      prev === la.level ? null : la.level,
                    )
                  }
                  title={`Hidden tasks (level ${la.level}): click to view`}
                >
                  +{la.overflow.length}
                </OverflowPill>
                {openOverflow === la.level && (
                  <OverflowPanel>
                    <OverflowHeader>
                      Hidden (Level {la.level})
                      <CloseBtn onClick={() => setOpenOverflow(null)}>
                        ×
                      </CloseBtn>
                    </OverflowHeader>
                    <OverflowList>
                      {la.overflow
                        .slice()
                        .sort((a, b) => {
                          if (b.durationDays !== a.durationDays)
                            return b.durationDays - a.durationDays;
                          return a.start.getTime() - b.start.getTime();
                        })
                        .map((t) => (
                          <OverflowItem
                            key={t.id}
                            title={`${t.title} (${t.durationDays}d)`}
                          >
                            <span>{t.title}</span>
                            <small>{t.durationDays}d</small>
                          </OverflowItem>
                        ))}
                    </OverflowList>
                  </OverflowPanel>
                )}
              </OverflowContainer>
            );
          })}
        </Inner>
      )}
    </Wrapper>
  );
};

export default VerticalGantt;

const Wrapper = styled.div`
  width: 100%;
  border: 1px solid ${COLORS.border.light};
  border-radius: 6px;
  overflow: auto;
  max-height: 520px;
  background: ${COLORS.background.primary};
`;

const Inner = styled.div`
  display: grid;
  position: relative;
`;

const HeaderLabel = styled.div`
  /* Explicit header row placement & stacking context (bars are behind). */
  position: relative;
  z-index: 5;
  padding: 8px 10px;
  background: ${COLORS.background.secondary};
  border-bottom: 1px solid ${COLORS.border.light};
  font-weight: 600;
  font-size: 14px;
  color: ${COLORS.text.primary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DateCell = styled.div`
  border-left: 1px solid ${COLORS.border.light};
  border-bottom: 1px solid ${COLORS.border.light};
  padding: 4px 8px;
  font-size: 12px;
  color: ${COLORS.text.primary};
  background: ${COLORS.background.primary};
`;

const GridCell = styled.div`
  border-left: 1px solid ${COLORS.border.light};
  border-bottom: 1px solid ${COLORS.border.light};
  background: ${COLORS.background.primary};
`;

const BarContainer = styled.div`
  position: relative;
  border-left: 1px solid ${COLORS.border.light};
  pointer-events: none;
`;

const Bar = styled.div`
  position: absolute;
  left: 8px;
  right: 8px;
  border-radius: 6px;
  color: white;
  padding: 4px 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  pointer-events: auto;
  transition: all 0.2s ease;

  &:hover {
    transform: translateX(2px);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  }
`;

const BarText = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
`;

const DurationBadge = styled.span`
  margin-left: 4px;
  background: rgba(255, 255, 255, 0.15);
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  background: ${COLORS.background.secondary};
  border: 1px solid ${COLORS.border.light};
  border-radius: 6px;
`;

const EmptyStateText = styled.h3`
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
  color: ${COLORS.text.primary};
`;

const EmptyStateSubtext = styled.p`
  margin: 0;
  font-size: 14px;
  color: ${COLORS.text.secondary};
`;

// Overflow UI
const OverflowContainer = styled.div`
  position: relative;
  pointer-events: none;
`;

const OverflowPill = styled.div`
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  background: ${COLORS.background.secondary};
  color: ${COLORS.text.primary};
  font-size: 11px;
  font-weight: 600;
  padding: 4px 6px;
  border-radius: 12px;
  border: 1px solid ${COLORS.border.light};
  cursor: pointer;
  text-align: center;
  pointer-events: auto;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  transition: background 0.15s ease;
  &:hover {
    background: ${COLORS.background.primary};
  }
`;

const OverflowPanel = styled.div`
  position: absolute;
  bottom: 40px;
  left: 8px;
  right: 8px;
  background: ${COLORS.background.primary};
  border: 1px solid ${COLORS.border.light};
  border-radius: 6px;
  padding: 6px 0 4px 0;
  max-height: 240px;
  overflow: auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  pointer-events: auto;
  z-index: 10;
`;

const OverflowHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  padding: 0 10px 6px 10px;
  color: ${COLORS.text.primary};
`;

const CloseBtn = styled.button`
  border: none;
  background: transparent;
  color: ${COLORS.text.secondary};
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
  padding: 2px 4px;
  &:hover {
    color: ${COLORS.text.primary};
  }
`;

const OverflowList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0 6px;
`;

const OverflowItem = styled.li`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: default;
  color: ${COLORS.text.primary};
  &:hover {
    background: ${COLORS.background.secondary};
  }
  & > small {
    color: ${COLORS.text.secondary};
    margin-left: 8px;
  }
`;

// Continuous mode axis & ticks
const AxisColumn = styled.div`
  position: relative;
  border-left: 1px solid ${COLORS.border.light};
  border-bottom: 1px solid ${COLORS.border.light};
  background: ${COLORS.background.primary};
  font-size: 11px;
  color: ${COLORS.text.secondary};
`;

const Tick = styled.div`
  position: absolute;
  left: 0;
  width: 100%;
  pointer-events: none;
`;

const TickLine = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: ${COLORS.border.light};
  opacity: 0.6;
`;

const TickLabel = styled.div`
  position: absolute;
  top: -7px;
  left: 4px;
  padding: 2px 4px;
  line-height: 1;
  background: ${COLORS.background.secondary};
  border: 1px solid ${COLORS.border.light};
  border-radius: 4px;
  color: ${COLORS.text.primary};
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
`;

const ScaleNotice = styled.div`
  position: absolute;
  bottom: 8px;
  right: 8px;
  padding: 2px 6px;
  font-size: 10px;
  line-height: 1.2;
  border-radius: 4px;
  background: ${COLORS.background.secondary};
  border: 1px solid ${COLORS.border.light};
  color: ${COLORS.text.secondary};
`;
