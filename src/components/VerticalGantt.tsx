import React, { useMemo, useState } from "react";
import styled from "@emotion/styled";
import { toDate, getDayIndex, getDurationDays, clampDays } from "../utils";
import { COLORS } from "../utils";
import type { GanttTask, DateRange } from "../types";

interface VerticalGanttProps {
  tasks: GanttTask[];
  rowHeight?: number; // px per day
  dateColumnWidth?: number; // px (first column after removal of legacy task label column)
  taskColumnWidth?: number; // px per lane column
  range?: DateRange; // optional explicit time range to display
  /** Maximum number of lane columns allocated per level (overflow tasks go into a pill). Default 6 */
  maxLanesPerLevel?: number;
  /** If true, show duration (days) inside bar for debugging */
  debugDurations?: boolean;
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

  const timeCalculations = useMemo(() => {
    if (parsedTasks.length === 0) {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + MS_PER_DAY);
      return {
        minStart: now,
        maxEnd: tomorrow,
        totalDays: 1,
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

    // Use provided range if present, otherwise derive from tasks
    const minStart = rangeStart ?? tasksMinStart;
    const maxEnd = rangeEnd ?? tasksMaxEnd;

    // Include the last day
    const totalDays =
      clampDays((maxEnd.getTime() - minStart.getTime()) / MS_PER_DAY) + 1;

    return { minStart, maxEnd, totalDays };
  }, [parsedTasks, range]);

  const { minStart, totalDays } = timeCalculations;
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

  // Compute column offsets for each level (after the date column which is column 1)
  const levelColumnOffsets = useMemo(() => {
    let offset = 0; // number of task columns already allocated
    const map = new Map<number, number>();
    for (const la of laneAssignments) {
      map.set(la.level, offset);
      offset += la.lanes.length; // only actual lanes, overflow not a new column
    }
    return map;
  }, [laneAssignments]);

  const totalTaskColumns = useMemo(
    () => laneAssignments.reduce((sum, la) => sum + la.lanes.length, 0),
    [laneAssignments],
  );

  const gridTemplateColumns = `${dateColumnWidth}px repeat(${totalTaskColumns}, ${taskColumnWidth}px)`;

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

  // If there are no tasks, render an empty state but ALL hooks above have already been called
  if (parsedTasks.length === 0) {
    return (
      <Wrapper>
        <Inner>
          <EmptyState>
            <EmptyStateText>No tasks to display</EmptyStateText>
            <EmptyStateSubtext>
              Add some schedules using the debug panel
            </EmptyStateSubtext>
          </EmptyState>
        </Inner>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <Inner style={{ gridTemplateColumns, gridAutoRows: `${rowHeight}px` }}>
        {/* Header row: Date column */}
        <HeaderLabel style={{ gridColumn: "1 / 2" }}>Date</HeaderLabel>
        {/* Lane headers per level */}
        {laneAssignments.map((la) => {
          const offset = levelColumnOffsets.get(la.level)!; // number of columns before this level
          return la.lanes.map((_, laneIdx) => {
            const colStart = 2 + offset + laneIdx; // 1=Date column -> start at 2
            return (
              <HeaderLabel
                key={`hdr-${la.level}-${laneIdx}`}
                style={{ gridColumn: `${colStart} / ${colStart + 1}` }}
                title={`Level ${la.level} Lane ${laneIdx}`}
              >
                L{la.level}-L{laneIdx}
              </HeaderLabel>
            );
          });
        })}

        {/* Date + background grid rows */}
        {Array.from({ length: totalDays }).map((_, dayIndex) => {
          const currentDate = new Date(
            minStart.getTime() + dayIndex * MS_PER_DAY,
          );
          const dateLabel = currentDate.toLocaleDateString();
          return (
            <React.Fragment key={`row-${dayIndex}`}>
              <DateCell style={{ gridColumn: "1 / 2" }}>{dateLabel}</DateCell>
              {laneAssignments.map((la) => {
                const offset = levelColumnOffsets.get(la.level)!;
                return la.lanes.map((_, laneIdx) => {
                  const colStart = 2 + offset + laneIdx;
                  return (
                    <GridCell
                      key={`cell-${dayIndex}-${la.level}-${laneIdx}`}
                      style={{ gridColumn: `${colStart} / ${colStart + 1}` }}
                    />
                  );
                });
              })}
            </React.Fragment>
          );
        })}

        {/* Bars for assigned tasks */}
        {allAssignedTasks.map(({ task, laneIndex, level }) => {
          const startIdx = getDayIndex(new Date(task.start), minStart);
          const duration = Math.max(
            1,
            getDurationDays(new Date(task.start), new Date(task.end)),
          );
          const top = startIdx * rowHeight;
          const height = duration * rowHeight - 4; // small padding
          const levelOffset = levelColumnOffsets.get(level)!;
          const colStart = 2 + levelOffset + laneIndex; // date column is 1
          return (
            <BarContainer
              key={`bar-${task.id}`}
              style={{
                gridColumn: `${colStart} / ${colStart + 1}`,
                gridRow: `1 / ${totalDays + 2}`,
              }}
            >
              <Bar
                title={`${task.title}: ${task.start.toString()} → ${task.end.toString()} (duration: ${duration}d)`}
                style={{
                  top: `${top + rowHeight + 2}px`,
                  height: `${height}px`,
                  backgroundColor: task.color || COLORS.primary,
                }}
              >
                <BarText>
                  {task.title}
                  {debugDurations && <DurationBadge>{duration}d</DurationBadge>}
                </BarText>
              </Bar>
            </BarContainer>
          );
        })}

        {/* Overflow pills */}
        {laneAssignments.map((la) => {
          if (!la.overflow.length) return null;
          const offset = levelColumnOffsets.get(la.level)!;
          const lastLaneIndex = Math.max(0, la.lanes.length - 1);
          const colStart = 2 + offset + lastLaneIndex;
          return (
            <OverflowContainer
              key={`overflow-${la.level}`}
              style={{
                gridColumn: `${colStart} / ${colStart + 1}`,
                gridRow: `1 / ${totalDays + 2}`,
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
                    <CloseBtn onClick={() => setOpenOverflow(null)}>×</CloseBtn>
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
