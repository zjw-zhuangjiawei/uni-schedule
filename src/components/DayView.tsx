import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
	querySchedules,
	createSchedule,
	type ScheduleDto,
	type CreateSchedulePayload,
} from "../api/schedule";

// Frontend representation
interface ScheduleItem {
	id: string;
	name: string;
	start: Date;
	end: Date;
	level: number;
	exclusive: boolean;
}

function toItem(dto: ScheduleDto): ScheduleItem {
	return {
		id: dto.id,
		name: dto.name,
		start: new Date(dto.start),
		end: new Date(dto.end),
		level: dto.level,
		exclusive: dto.exclusive,
	};
}

const HOUR_MS = 3600_000;

const levelColors = [
	"#2563eb", // level 0
	"#16a34a", // level 1
	"#d97706", // level 2
	"#9333ea", // level 3
	"#dc2626", // level 4
];

function colorFor(item: ScheduleItem) {
	const base = levelColors[item.level % levelColors.length];
	if (!item.exclusive) return base;
	// Slight transform for exclusive (add pattern-ish via linear-gradient in style)
	return base;
}

interface GanttProps {
	items: ScheduleItem[];
	pxPerHour: number;
}

const VerticalGantt: React.FC<GanttProps> = ({ items, pxPerHour }) => {
	const dayStart = useMemo(() => {
		const d = new Date(items[0]?.start ?? Date.now());
		d.setHours(0, 0, 0, 0);
		return d;
	}, [items]);
	const hours = [...Array(25).keys()];
	const maxLevel = items.reduce((m, it) => Math.max(m, it.level), 0);
	const chartWidth = 640; // px for bars region
	const laneWidth = chartWidth / (maxLevel + 1);
	const height = 24 * pxPerHour;

	// Pre-sort items (stable order for layout): by level then start then longer first
	const sorted = [...items].sort(
		(a, b) =>
			a.level - b.level ||
			a.start.getTime() - b.start.getTime() ||
			b.end.getTime() - a.end.getTime()
	);

	// Compute overlap columns per level so overlapping intervals at the same level share horizontal space
	type LayoutInfo = { id: string; col: number; colsInGroup: number };
	const layoutMap: Record<string, LayoutInfo> = {};
	for (let level = 0; level <= maxLevel; level++) {
		const levelItems = sorted.filter((i) => i.level === level);
		if (levelItems.length === 0) continue;
		// Sort by start time
		levelItems.sort((a, b) => a.start.getTime() - b.start.getTime());
		interface ActiveCol {
			end: number;
			col: number;
		}
		let active: ActiveCol[] = [];
		let groupId = 0;
		const groupItems: Record<number, string[]> = {};
		const groupMaxCol: Record<number, number> = {};
		for (const it of levelItems) {
			const startMs = it.start.getTime();
			// Clean finished columns
			active = active.filter((a) => a.end > startMs);
			if (active.length === 0) {
				groupId += 1; // new group
			}
			// Find first free column
			let assignedCol = 0;
			while (true) {
				const occupied = active.find((a) => a.col === assignedCol);
				if (!occupied) break;
				assignedCol++;
			}
			active.push({ end: it.end.getTime(), col: assignedCol });
			groupItems[groupId] = groupItems[groupId] || [];
			groupItems[groupId].push(it.id);
			groupMaxCol[groupId] = Math.max(groupMaxCol[groupId] ?? 0, assignedCol);
			layoutMap[it.id] = { id: it.id, col: assignedCol, colsInGroup: 0 }; // fill cols later
		}
		// Assign total cols for each item based on group
		for (const gid of Object.keys(groupItems)) {
			const totalCols = (groupMaxCol[+gid] ?? 0) + 1;
			for (const id of groupItems[+gid]) {
				layoutMap[id].colsInGroup = totalCols;
			}
		}
	}

	const timeToY = (t: Date) =>
		((t.getTime() - dayStart.getTime()) / HOUR_MS) * pxPerHour;

	const [hovered, setHovered] = useState<ScheduleItem | null>(null);

	return (
		<div style={{ display: "flex", gap: "1rem" }}>
			{/* Time axis */}
			<div
				style={{
					position: "relative",
					height,
					borderRight: "1px solid #e2e8f0",
					paddingRight: 8,
				}}
			>
				{hours.map((h) => {
					const top = h * pxPerHour;
					return (
						<div
							key={h}
							style={{
								position: "absolute",
								top,
								transform: "translateY(-50%)",
								fontSize: 12,
								color: "#475569",
							}}
						>
							{h.toString().padStart(2, "0")}:00
						</div>
					);
				})}
			</div>
			{/* Grid & bars */}
			<div
				style={{
					position: "relative",
					width: chartWidth,
					height,
					background:
						"repeating-linear-gradient(#f8fafc 0px, #f8fafc " +
						(pxPerHour - 1) +
						"px, #e2e8f0 " +
						pxPerHour +
						"px)",
				}}
			>
				{/* Hour grid lines */}
				{hours.map((h) => (
					<div
						key={h}
						style={{
							position: "absolute",
							top: h * pxPerHour,
							left: 0,
							right: 0,
							height: 1,
							background: "#e2e8f0",
						}}
					/>
				))}
				{sorted.map((it) => {
					const top = timeToY(it.start);
					const bottom = timeToY(it.end);
					// Overlap layout within level
					const layout = layoutMap[it.id];
					const totalCols = layout?.colsInGroup || 1;
					const gap = 4;
					const innerWidth = laneWidth - 8; // padding inside lane
					const colWidth = (innerWidth - gap * (totalCols - 1)) / totalCols;
					const left =
						it.level * laneWidth + 4 + (layout?.col || 0) * (colWidth + gap);
					const width = colWidth;
					const color = colorFor(it);
					const exclusivePattern = it.exclusive
						? "repeating-linear-gradient(45deg, rgba(0,0,0,0.15) 0 6px, transparent 6px 12px)"
						: "none";
					return (
						<div
							key={it.id}
							onMouseEnter={() => setHovered(it)}
							onMouseLeave={() =>
								setHovered((cur) => (cur?.id === it.id ? null : cur))
							}
							style={{
								position: "absolute",
								top,
								left,
								height: bottom - top,
								width,
								borderRadius: 6,
								background: color,
								boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
								color: "white",
								padding: "2px 4px",
								fontSize: 12,
								overflow: "hidden",
								cursor: "pointer",
								display: "flex",
								flexDirection: "column",
								justifyContent: "space-between",
								backgroundImage: exclusivePattern,
								backgroundBlendMode: "overlay",
							}}
						>
							<span style={{ fontWeight: 600, lineHeight: 1.1 }}>
								{it.name}
							</span>
							<span style={{ opacity: 0.85 }}>
								{formatTime(it.start)} - {formatTime(it.end)}
							</span>
						</div>
					);
				})}
				{/* Hover tooltip */}
				{hovered && (
					<div
						style={{
							position: "absolute",
							top: timeToY(hovered.start),
							left: hovered.level * laneWidth + laneWidth + 12,
							background: "#0f172a",
							color: "white",
							padding: "6px 8px",
							borderRadius: 6,
							fontSize: 12,
							maxWidth: 220,
							zIndex: 20,
						}}
					>
						<div style={{ fontWeight: 600, marginBottom: 4 }}>
							{hovered.name}
						</div>
						<div>Level: {hovered.level}</div>
						<div>Exclusive: {hovered.exclusive ? "Yes" : "No"}</div>
						<div>
							{formatTime(hovered.start)} - {formatTime(hovered.end)}
						</div>
						<div style={{ opacity: 0.7 }}>ID: {hovered.id}</div>
					</div>
				)}
			</div>
			{/* Legend / Controls */}
			<div
				style={{
					width: 220,
					fontSize: 12,
					display: "flex",
					flexDirection: "column",
					gap: 12,
				}}
			>
				<div>
					<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						<span style={{ fontWeight: 600 }}>Zoom (px/hour)</span>
						<input
							type="range"
							min={30}
							max={200}
							value={pxPerHour}
							onChange={() => {
								// handled in parent
							}}
							disabled
						/>
						<span>{pxPerHour}</span>
					</label>
				</div>
				<div>
					<div style={{ fontWeight: 600, marginBottom: 4 }}>Levels</div>
					{[...Array(maxLevel + 1).keys()].map((l) => (
						<div
							key={l}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 6,
								marginBottom: 4,
							}}
						>
							<div
								style={{
									width: 14,
									height: 14,
									borderRadius: 4,
									background: levelColors[l % levelColors.length],
								}}
							/>
							<span>Level {l}</span>
						</div>
					))}
					<div style={{ marginTop: 8 }}>
						Exclusive bars have diagonal hatch overlay.
					</div>
				</div>
			</div>
		</div>
	);
};

function formatTime(d: Date) {
	return d.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

const DayView: React.FC = () => {
	const [items, setItems] = useState<ScheduleItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pxPerHour, setPxPerHour] = useState(70);

	// Form state
	const now = useMemo(() => new Date(), []);
	const defaultStartIso = useMemo(() => {
		const d = new Date(now);
		d.setMinutes(0, 0, 0);
		return d.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm
	}, [now]);
	const [form, setForm] = useState({
		name: "",
		start: defaultStartIso,
		durationHours: 1,
		level: 0,
		exclusive: false,
	});
	const [submitting, setSubmitting] = useState(false);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const list = await querySchedules({});
			setItems(
				list.map(toItem).sort((a, b) => a.start.getTime() - b.start.getTime())
			);
		} catch (e: any) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const onChange = (
		e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
	) => {
		const { name, value, type, checked } = e.target as any;
		setForm((f) => ({
			...f,
			[name]:
				type === "checkbox"
					? checked
					: name === "durationHours" || name === "level"
					? Number(value)
					: value,
		}));
	};

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			const start = new Date(form.start);
			const end = new Date(start.getTime() + form.durationHours * 3600_000);
			const payload: CreateSchedulePayload = {
				start: start.toISOString(),
				end: end.toISOString(),
				level: form.level,
				exclusive: form.exclusive,
				name: form.name || "(untitled)",
				parents: [],
			};
			await createSchedule(payload);
			await refresh();
			setForm((f) => ({ ...f, name: "" }));
		} catch (e: any) {
			setError(String(e));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
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
				<div
					style={{
						width: 300,
						display: "flex",
						flexDirection: "column",
						gap: 16,
					}}
				>
					<form
						onSubmit={onSubmit}
						style={{ display: "flex", flexDirection: "column", gap: 8 }}
					>
						<h3 style={{ margin: 0, fontSize: 16 }}>New Schedule</h3>
						<label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
							<span>Name</span>
							<input
								name="name"
								value={form.name}
								onChange={onChange}
								placeholder="Title"
							/>
						</label>
						<label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
							<span>Start</span>
							<input
								type="datetime-local"
								name="start"
								value={form.start}
								onChange={onChange}
							/>
						</label>
						<label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
							<span>Duration (hours)</span>
							<input
								name="durationHours"
								type="number"
								min={0.25}
								step={0.25}
								value={form.durationHours}
								onChange={onChange}
							/>
						</label>
						<label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
							<span>Level</span>
							<input
								name="level"
								type="number"
								min={0}
								value={form.level}
								onChange={onChange}
							/>
						</label>
						<label style={{ display: "flex", alignItems: "center", gap: 6 }}>
							<input
								type="checkbox"
								name="exclusive"
								checked={form.exclusive}
								onChange={onChange}
							/>
							<span>Exclusive</span>
						</label>
						<button
							type="submit"
							disabled={submitting}
							style={{ padding: "6px 10px" }}
						>
							{submitting ? "Creating…" : "Create"}
						</button>
						<button
							type="button"
							onClick={refresh}
							style={{ padding: "4px 8px" }}
							disabled={loading}
						>
							Refresh
						</button>
						<label
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 2,
								marginTop: 8,
							}}
						>
							<span>Zoom (px/hour)</span>
							<input
								type="range"
								min={30}
								max={200}
								value={pxPerHour}
								onChange={(e) => setPxPerHour(Number(e.target.value))}
							/>
							<span>{pxPerHour}</span>
						</label>
					</form>
				</div>
			</div>
		</div>
	);
};

export default DayView;
