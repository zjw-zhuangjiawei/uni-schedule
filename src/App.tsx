import { useMemo } from "react";
import VerticalGantt from "./components/VerticalGantt";
import DebugSchedulePanel from "./components/DebugSchedulePanel";
import { Button, LoadingSpinner, ErrorMessage } from "./components/ui";
import { useSchedules, useToggle } from "./hooks";
import { generateScheduleColor } from "./utils";
import type { GanttTask, DateRange } from "./types";

function App() {
  const debugPanel = useToggle(false);
  const { schedules, isLoading, error, refreshSchedules } = useSchedules();

  // Convert schedules to Gantt tasks
  const tasks = useMemo(
    (): GanttTask[] =>
      schedules.map((schedule) => ({
        id: schedule.id,
        title: schedule.name,
        start: schedule.start,
        end: schedule.end,
        color: generateScheduleColor(schedule.id, schedule.level),
      })),
    [schedules],
  );

  // Derive time range from schedules
  const timeRange = useMemo((): DateRange | undefined => {
    if (schedules.length === 0) return undefined;

    const minStart = schedules.reduce(
      (min, schedule) => (schedule.start < min ? schedule.start : min),
      schedules[0].start,
    );
    const maxEnd = schedules.reduce(
      (max, schedule) => (schedule.end > max ? schedule.end : max),
      schedules[0].end,
    );

    return { start: minStart, end: maxEnd };
  }, [schedules]);

  const defaultRange: DateRange = {
    start: new Date(),
    end: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
  };

  return (
    <main style={{ padding: 16 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
          University Schedule
        </h1>
        <Button variant="primary" onClick={debugPanel.toggle}>
          {debugPanel.value ? "Hide" : "Show"} Debug Panel
        </Button>
      </header>

      <p
        style={{
          fontSize: 14,
          color: "#666",
          marginBottom: 16,
          lineHeight: 1.5,
        }}
      >
        Use the debug panel to create and manage schedules. In development mode,
        data is stored in memory. When running as a Tauri app, data is
        persisted.
      </p>

      {error && (
        <ErrorMessage
          title="Failed to load schedules"
          message={error}
          onRetry={refreshSchedules}
        />
      )}

      {isLoading && schedules.length === 0 && (
        <LoadingSpinner text="Loading schedules..." />
      )}

      <VerticalGantt tasks={tasks} range={timeRange || defaultRange} />

      <DebugSchedulePanel
        open={debugPanel.value}
        onClose={debugPanel.setFalse}
        onDataChange={refreshSchedules}
      />
    </main>
  );
}

export default App;
