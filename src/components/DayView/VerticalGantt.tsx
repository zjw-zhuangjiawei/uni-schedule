import React, {
	useMemo,
	useState,
	useCallback,
	useRef,
	useEffect,
} from "react";
import { css } from "@emotion/react";
import type { GanttProps, ScheduleItem } from "./types";
import { HOUR_MS, formatTime, colorFor } from "./utils";
import { TimeAxis } from "./TimeAxis";
import { Tooltip } from "./Tooltip";
import { Sidebar } from "./Sidebar";

/** Dynamic interval-based lane splitting.
 * We break each level into elementary time slices (between any start/end boundary).
 * Each slice width is divided only among items active in that slice (concurrency).
 * Items can therefore change width along their duration.
 */
interface SegmentMeta {
	item: ScheduleItem;
	start: number; // ms
	end: number; // ms
	col: number; // column index within this slice
	concurrency: number; // number of active items in slice
}

function computeDynamicSegments(items: ScheduleItem[]): SegmentMeta[] {
	const byLevel: Record<number, ScheduleItem[]> = {};
	for (const it of items) (byLevel[it.level] ||= []).push(it);
	const segments: SegmentMeta[] = [];
	for (const levelStr in byLevel) {
		const levelItems = byLevel[+levelStr].filter((i) => i.end > i.start);
		if (!levelItems.length) continue;
		type Ev = { t: number; type: "start" | "end"; item: ScheduleItem };
		const events: Ev[] = [];
		for (const it of levelItems) {
			events.push({ t: it.start.getTime(), type: "start", item: it });
			events.push({ t: it.end.getTime(), type: "end", item: it });
		}
		// sort: time asc; end before start (so touching intervals aren't overlap)
		events.sort((a, b) => a.t - b.t || (a.type === "end" ? -1 : 1));
		interface Active {
			id: string;
			col: number;
			item: ScheduleItem;
		}
		let active: Active[] = [];
		let lastT: number | null = null;
		const emitSlice = (start: number, end: number) => {
			if (start >= end || active.length === 0) return;
			const concurrency = active.length;
			for (const a of active)
				segments.push({ item: a.item, start, end, col: a.col, concurrency });
		};
		for (const ev of events) {
			if (lastT !== null && ev.t > lastT) emitSlice(lastT, ev.t);
			if (ev.type === "end") {
				active = active.filter((a) => a.id !== ev.item.id);
			} else {
				const used = new Set(active.map((a) => a.col));
				let col = 0;
				while (used.has(col)) col++;
				active.push({ id: ev.item.id, col, item: ev.item });
			}
			lastT = ev.t;
		}
	}
	// Merge adjacent segments for same item/col/concurrency
	segments.sort(
		(a, b) => a.item.level - b.item.level || a.start - b.start || a.col - b.col
	);
	const merged: SegmentMeta[] = [];
	for (const seg of segments) {
		const prev = merged[merged.length - 1];
		if (
			prev &&
			prev.item.id === seg.item.id &&
			prev.end === seg.start &&
			prev.col === seg.col &&
			prev.concurrency === seg.concurrency
		) {
			prev.end = seg.end;
		} else {
			merged.push({ ...seg });
		}
	}
	return merged;
}

interface Rect {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	item: ScheduleItem;
	start: number;
	end: number;
}

// Layout styling constants (gap redesign)
const LANE_SIDE_PADDING = 6; // padding inside each lane
const COLUMN_GAP = 6; // horizontal gap between concurrent schedules
const MIN_CELL_WIDTH = 12; // minimum width safeguard
const OUTER_CORNER_RADIUS = 6; // rounded outer corners only
const VERTICAL_MARGIN_TOP = 2; // margin inside each item's time range
const VERTICAL_MARGIN_BOTTOM = 2;

export const VerticalGantt: React.FC<GanttProps> = ({ items, pxPerHour }) => {
	const dayStart = useMemo(() => {
		const d = new Date(items[0]?.start ?? Date.now());
		d.setHours(0, 0, 0, 0);
		return d;
	}, [items]);

	const hours = [...Array(25).keys()];
	const maxLevel = useMemo(
		() => items.reduce((m, i) => Math.max(m, i.level), 0),
		[items]
	);

	const baseChartWidth = 640;
	const maxLaneWidth = 220;
	const calculatedLaneWidth = baseChartWidth / (maxLevel + 1 || 1);
	const laneWidth = Math.min(calculatedLaneWidth, maxLaneWidth);
	const chartWidth = Math.max(baseChartWidth, laneWidth * (maxLevel + 1));
	const height = 24 * pxPerHour;

	const segments = useMemo(() => computeDynamicSegments(items), [items]);

	const timeToY = useCallback(
		(t: Date) => ((t.getTime() - dayStart.getTime()) / HOUR_MS) * pxPerHour,
		[dayStart, pxPerHour]
	);

	const [hovered, setHovered] = useState<ScheduleItem | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const rectsRef = useRef<Rect[]>([]);

	// Draw
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = chartWidth * dpr;
		canvas.height = height * dpr;
		canvas.style.width = chartWidth + "px";
		canvas.style.height = height + "px";
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, chartWidth, height);

		// background hour stripes
		ctx.fillStyle = "#f8fafc";
		ctx.fillRect(0, 0, chartWidth, height);
		for (let h = 0; h < 24; h++) {
			const y = h * pxPerHour;
			ctx.fillStyle = h % 2 === 0 ? "rgba(0,0,0,0.015)" : "rgba(0,0,0,0.03)";
			ctx.fillRect(0, y, chartWidth, pxPerHour);
		}
		// hour lines
		ctx.strokeStyle = "#e2e8f0";
		ctx.lineWidth = 1;
		for (const h of hours) {
			const y = h * pxPerHour;
			ctx.beginPath();
			ctx.moveTo(0, y + 0.5);
			ctx.lineTo(chartWidth, y + 0.5);
			ctx.stroke();
		}

		// Draw vertical separators between lanes
		ctx.strokeStyle = "#cbd5e1";
		for (let lvl = 1; lvl <= maxLevel; lvl++) {
			const x = lvl * laneWidth;
			ctx.beginPath();
			ctx.moveTo(x + 0.5, 0);
			ctx.lineTo(x + 0.5, height);
			ctx.stroke();
		}

		// Build rects from segments
		const rects: Rect[] = [];
		const gap = COLUMN_GAP;
		const padding = LANE_SIDE_PADDING; // lane inner padding
		for (const seg of segments) {
			const baseX = seg.item.level * laneWidth;
			const innerWidth = laneWidth - padding * 2;
			const concurrency = seg.concurrency;
			let cellWidth =
				concurrency === 1
					? innerWidth
					: (innerWidth - gap * (concurrency - 1)) / concurrency;
			if (cellWidth < MIN_CELL_WIDTH) {
				// shrink gap proportionally if cells too narrow
				const totalGap = Math.max(0, innerWidth - concurrency * MIN_CELL_WIDTH);
				const adjustedGap = concurrency > 1 ? totalGap / (concurrency - 1) : 0;
				cellWidth = MIN_CELL_WIDTH;
				// recompute x using adjusted gap (override gap in placement)
				const x = baseX + padding + seg.col * (cellWidth + adjustedGap);
				const y1 = timeToY(new Date(seg.start));
				const y2 = timeToY(new Date(seg.end));
				if (y2 > y1)
					rects.push({
						id: seg.item.id + ":" + seg.start + ":" + seg.end,
						x,
						y: y1,
						w: cellWidth,
						h: y2 - y1,
						item: seg.item,
						start: seg.start,
						end: seg.end,
					});
				continue;
			}
			const x =
				baseX + padding + seg.col * (cellWidth + (concurrency === 1 ? 0 : gap));
			let y1 = timeToY(new Date(seg.start)) + VERTICAL_MARGIN_TOP;
			let y2 = timeToY(new Date(seg.end)) - VERTICAL_MARGIN_BOTTOM;
			if (y2 - y1 < 3) y2 = y1 + 3; // ensure minimal height
			if (y2 <= y1) continue;
			rects.push({
				id: seg.item.id + ":" + seg.start + ":" + seg.end,
				x,
				y: y1,
				w: cellWidth,
				h: y2 - y1,
				item: seg.item,
				start: seg.start,
				end: seg.end,
			});
		}

		// Draw each segment; text only on first segment of an item
		// Draw each rect with fully rounded corners (all corners), treat them as unified visually
		const byItem: Record<string, Rect[]> = {};
		for (const r of rects) (byItem[r.item.id] ||= []).push(r);
		for (const id in byItem) {
			const segs = byItem[id];
			const item = segs[0].item;
			// Draw segments from back to front to reduce seam visibility
			for (let i = 0; i < segs.length; i++) {
				const r = segs[i];
				const color = colorFor(item);
				ctx.save();
				ctx.beginPath();
				const radius = OUTER_CORNER_RADIUS;
				const rh = Math.min(radius, r.h / 2, r.w / 2);
				// rounded rect path
				ctx.moveTo(r.x + rh, r.y);
				ctx.lineTo(r.x + r.w - rh, r.y);
				ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + rh, rh);
				ctx.lineTo(r.x + r.w, r.y + r.h - rh);
				ctx.arcTo(r.x + r.w, r.y + r.h, r.x + r.w - rh, r.y + r.h, rh);
				ctx.lineTo(r.x + rh, r.y + r.h);
				ctx.arcTo(r.x, r.y + r.h, r.x, r.y + r.h - rh, rh);
				ctx.lineTo(r.x, r.y + rh);
				ctx.arcTo(r.x, r.y, r.x + rh, r.y, rh);
				ctx.closePath();
				ctx.fillStyle = color;
				ctx.fill();
				if (item.exclusive) {
					ctx.save();
					ctx.clip();
					ctx.strokeStyle = "rgba(255,255,255,0.35)";
					ctx.lineWidth = 2;
					const step = 8;
					for (let k = -r.h; k < r.w + r.h; k += step) {
						ctx.beginPath();
						ctx.moveTo(r.x + k, r.y);
						ctx.lineTo(r.x + k + r.h, r.y + r.h);
						ctx.stroke();
					}
					ctx.restore();
				}
				// Only draw label on first segment (earliest by start time)
				if (i === 0) {
					ctx.fillStyle = "#ffffff";
					ctx.font = "600 12px system-ui, sans-serif";
					ctx.textBaseline = "top";
					let nameDraw = item.name;
					const maxTextWidth = r.w - 8;
					if (ctx.measureText(nameDraw).width > maxTextWidth) {
						while (
							nameDraw.length > 1 &&
							ctx.measureText(nameDraw + "…").width > maxTextWidth
						)
							nameDraw = nameDraw.slice(0, -1);
						nameDraw += "…";
					}
					ctx.fillText(nameDraw, r.x + 4, r.y + 4);
					if (r.h > 26) {
						ctx.font = "400 11px system-ui, sans-serif";
						ctx.globalAlpha = 0.85;
						ctx.fillText(
							`${formatTime(item.start)}-${formatTime(item.end)}`,
							r.x + 4,
							r.y + 18
						);
						ctx.globalAlpha = 1;
					}
				}
				ctx.restore();
			}
		}
		rectsRef.current = rects;
	}, [segments, chartWidth, laneWidth, height, pxPerHour, maxLevel, timeToY]);

	// mouse handling for hover
	const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const rects = rectsRef.current;
		for (let i = rects.length - 1; i >= 0; i--) {
			const r = rects[i];
			if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
				setHovered(r.item);
				return;
			}
		}
		setHovered(null);
	}, []);
	const onMouseLeave = useCallback(() => setHovered(null), []);

	return (
		<div
			css={css`
				display: flex;
				gap: 1rem;
			`}
		>
			<TimeAxis hours={hours} pxPerHour={pxPerHour} height={height} />
			<div
				css={css`
					position: relative;
					width: ${chartWidth}px;
					height: ${height}px;
					user-select: none;
				`}
			>
				<canvas
					ref={canvasRef}
					onMouseMove={onMouseMove}
					onMouseLeave={onMouseLeave}
				/>
				{hovered && (
					<Tooltip
						item={hovered}
						top={timeToY(hovered.start)}
						left={hovered.level * laneWidth + laneWidth + 12}
					/>
				)}
			</div>
			<Sidebar pxPerHour={pxPerHour} maxLevel={maxLevel} />
		</div>
	);
};
