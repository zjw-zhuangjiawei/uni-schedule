import React, { useMemo } from "react";
import styled from "@emotion/styled";
import { toDate, getDayIndex, getDurationDays, clampDays } from "../utils";
import { COLORS } from "../utils";
import type { GanttTask, DateRange } from "../types";

interface VerticalGanttProps {
  tasks: GanttTask[];
  rowHeight?: number; // px per day
  labelWidth?: number; // px
  dateColumnWidth?: number; // px
  taskColumnWidth?: number; // px
  range?: DateRange; // optional explicit time range to display
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export default function VerticalGantt({
  tasks,
  rowHeight = 28,
  labelWidth = 200,
  dateColumnWidth = 120,
  taskColumnWidth = 140,
  range,
}: VerticalGanttProps) {
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

  if (parsedTasks.length === 0) {
    return (
      <EmptyState>
        <EmptyStateText>No tasks to display</EmptyStateText>
        <EmptyStateSubtext>
          Add some schedules using the debug panel
        </EmptyStateSubtext>
      </EmptyState>
    );
  }

  const gridTemplateColumns = `${labelWidth}px ${dateColumnWidth}px repeat(${parsedTasks.length}, ${taskColumnWidth}px)`;

  return (
    <Wrapper>
      <Inner
        style={{
          gridTemplateColumns,
          gridAutoRows: `${rowHeight}px`,
        }}
      >
        {/* Header row */}
        <HeaderLabel style={{ gridColumn: "1 / 2" }}>Tasks</HeaderLabel>
        <HeaderLabel style={{ gridColumn: "2 / 3" }}>Date</HeaderLabel>
        {parsedTasks.map((task, index) => (
          <HeaderLabel
            key={task.id}
            style={{ gridColumn: `${3 + index} / ${4 + index}` }}
            title={`${task.title} (${task.start.toLocaleDateString()} - ${task.end.toLocaleDateString()})`}
          >
            {task.title}
          </HeaderLabel>
        ))}

        {/* Date rows + task area grid */}
        {Array.from({ length: totalDays }).map((_, dayIndex) => {
          const currentDate = new Date(
            minStart.getTime() + dayIndex * MS_PER_DAY,
          );
          const dateLabel = currentDate.toLocaleDateString();

          return (
            <React.Fragment key={`row-${dayIndex}`}>
              <LabelCell style={{ gridColumn: "1 / 2" }}>&nbsp;</LabelCell>
              <DateCell style={{ gridColumn: "2 / 3" }}>{dateLabel}</DateCell>
              {parsedTasks.map((task) => (
                <GridCell
                  key={`${task.id}-${dayIndex}`}
                  style={{ gridColumn: "auto / auto" }}
                />
              ))}
            </React.Fragment>
          );
        })}

        {/* Task bars: absolutely positioned */}
        {parsedTasks.map((task, taskIndex) => {
          const startIdx = getDayIndex(new Date(task.start), minStart);
          const duration = getDurationDays(
            new Date(task.start),
            new Date(task.end),
          );
          const top = startIdx * rowHeight;
          const height = Math.max(1, duration) * rowHeight - 4; // Small padding
          const leftColumn = 3 + taskIndex; // Grid column where this task sits

          return (
            <BarContainer
              key={`bar-${task.id}`}
              style={{
                gridColumn: `${leftColumn} / ${leftColumn + 1}`,
                gridRow: `1 / ${totalDays + 2}`, // +2 to account for header
              }}
            >
              <Bar
                title={`${task.title}: ${task.start.toString()} → ${task.end.toString()}`}
                style={{
                  top: `${top + rowHeight + 2}px`, // +rowHeight for header, +2 for padding
                  height: `${height}px`,
                  backgroundColor: task.color || COLORS.primary,
                }}
              >
                <BarText>{task.title}</BarText>
              </Bar>
            </BarContainer>
          );
        })}
      </Inner>
    </Wrapper>
  );
}

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

const LabelCell = styled.div`
  border-bottom: 1px solid ${COLORS.border.light};
  background: ${COLORS.background.primary};
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
