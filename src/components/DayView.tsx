import React, { useMemo, useState, useEffect } from "react";
import type { FormState } from "./DayView/types";
import { createDefaultStartTime } from "./DayView/utils";
import { useSchedules } from "./DayView/hooks";
import { VerticalGantt } from "./DayView/VerticalGantt";
import { ScheduleForm } from "./DayView/ScheduleForm";
import DebugPanel from "./DayView/DebugPanel";

const DayView: React.FC = () => {
	const { items, loading, error, refresh, setError } = useSchedules();
	const [pxPerHour, setPxPerHour] = useState(70);

	// Form state
	const defaultStartIso = useMemo(() => createDefaultStartTime(), []);
	const [form, setForm] = useState<FormState>({
		name: "",
		start: defaultStartIso,
		durationHours: 1,
		level: 0,
		exclusive: false,
	});
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return (
		<div style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
			<DebugPanel onDataChanged={refresh} />
			<h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Day View</h2>
			<div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
				<div style={{ flex: 1, minWidth: 0 }}>
					{loading && <div style={{ marginBottom: 8 }}>Loading…</div>}
					{error && (
						<div style={{ marginBottom: 8, color: "#dc2626" }}>
							Error: {error}
						</div>
					)}
					{items.length === 0 && !loading && (
						<div style={{ marginBottom: 8, color: "#475569" }}>
							No schedules yet.
						</div>
					)}
					<VerticalGantt items={items} pxPerHour={pxPerHour} />
				</div>
				<ScheduleForm
					form={form}
					setForm={setForm}
					submitting={submitting}
					setSubmitting={setSubmitting}
					setError={setError}
					onSuccess={refresh}
					pxPerHour={pxPerHour}
					setPxPerHour={setPxPerHour}
					onRefresh={refresh}
					loading={loading}
				/>
			</div>
		</div>
	);
};

export default DayView;
