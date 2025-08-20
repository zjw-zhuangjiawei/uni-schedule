import React, { useMemo, useState, useEffect, useCallback } from "react";
import { css } from "@emotion/react";
import type { GanttProps, ScheduleItem } from "./types";
import { HOUR_MS, AGGREGATE_THRESHOLD } from "./utils";
import { computeLayout } from "./layoutUtils";
import { TimeAxis } from "./TimeAxis";
import { ScheduleBar } from "./ScheduleBar";
import { AggregateBar } from "./AggregateBar";
import { Tooltip } from "./Tooltip";
import { Sidebar } from "./Sidebar";

export const VerticalGantt: React.FC<GanttProps> = ({ items, pxPerHour }) => {
	const dayStart = useMemo(() => {
		const d = new Date(items[0]?.start ?? Date.now());
		d.setHours(0, 0, 0, 0);
		return d;
	}, [items]);

	const hours = [...Array(25).keys()];

	// Layout + aggregation useMemo
	const { groups, layoutMap, maxLevel } = useMemo(
		() => computeLayout(items, AGGREGATE_THRESHOLD),
		[items]
	);

	const baseChartWidth = 640; // 基础图表宽度
	const maxLaneWidth = 200; // 理想的最大lane宽度
	const calculatedLaneWidth = baseChartWidth / (maxLevel + 1 || 1);
	const laneWidth = Math.min(calculatedLaneWidth, maxLaneWidth);
	// 如果使用约束后的lane宽度，调整图表宽度以适应内容
	const chartWidth = Math.max(baseChartWidth, laneWidth * (maxLevel + 1));
	console.log("Calculated chart width:", chartWidth);
	console.log("Calculated lane width:", calculatedLaneWidth);
	const height = 24 * pxPerHour;

	// Expanded aggregated groups
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

	useEffect(() => {
		// 当 items 变化（例如刷新）时移除不再存在的 group id
		setExpandedGroups((prev) => {
			const next = new Set<string>();
			for (const g of groups) if (prev.has(g.id)) next.add(g.id);
			return next;
		});
	}, [groups]);

	const toggleGroup = useCallback((gid: string) => {
		setExpandedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(gid)) next.delete(gid);
			else next.add(gid);
			return next;
		});
	}, []);

	// Render list of items (exclude those hidden by aggregation)
	const visibleItems = useMemo(() => {
		const hidden = new Set<string>();
		for (const g of groups) {
			if (g.aggregate && !expandedGroups.has(g.id)) {
				for (const id of g.itemIds) hidden.add(id);
			}
		}
		return items
			.filter((it) => !hidden.has(it.id))
			.sort(
				(a, b) =>
					a.level - b.level ||
					a.start.getTime() - b.start.getTime() ||
					b.end.getTime() - a.end.getTime()
			);
	}, [groups, expandedGroups, items]);

	const timeToY = useCallback(
		(t: Date) => ((t.getTime() - dayStart.getTime()) / HOUR_MS) * pxPerHour,
		[dayStart, pxPerHour]
	);

	// 不使用居中偏移，直接使用约束后的lane宽度
	const centerOffset = 0;

	const [hovered, setHovered] = useState<ScheduleItem | null>(null);

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
					overflow: hidden; /* 防止内容溢出图表边界 */
					background: repeating-linear-gradient(
						#f8fafc 0px,
						#f8fafc ${pxPerHour - 1}px,
						#e2e8f0 ${pxPerHour}px
					);
				`}
			>
				{hours.map((h) => (
					<div
						key={h}
						css={css`
							position: absolute;
							top: ${h * pxPerHour}px;
							left: 0;
							right: 0;
							height: 1px;
							background: #e2e8f0;
						`}
					/>
				))}

				{/* 聚合条 (collapsed groups) */}
				{groups.map((g) => {
					if (!g.aggregate || expandedGroups.has(g.id)) return null;
					const top = timeToY(g.start);
					const bottom = timeToY(g.end);
					const left = centerOffset + g.level * laneWidth + 4; // 占满该 level lane
					const width = laneWidth - 8;
					return (
						<AggregateBar
							key={g.id}
							group={g}
							top={top}
							bottom={bottom}
							left={left}
							width={width}
							onClick={() => toggleGroup(g.id)}
						/>
					);
				})}

				{/* 展开时的折叠按钮 */}
				{groups.map((g) => {
					if (!(g.aggregate && expandedGroups.has(g.id))) return null;
					const top = timeToY(g.start) - 14; // 放在组上方
					const left = centerOffset + g.level * laneWidth + 4;
					return (
						<button
							key={g.id + "-collapse"}
							onClick={() => toggleGroup(g.id)}
							css={css`
								position: absolute;
								top: ${Math.max(0, top)}px;
								left: ${left}px;
								z-index: 15;
								background: #334155;
								color: #fff;
								border: none;
								font-size: 10px;
								padding: 2px 6px;
								border-radius: 4px;
								cursor: pointer;
								box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
							`}
						>
							折叠
						</button>
					);
				})}

				{/* 普通条目 */}
				{visibleItems.map((it) => {
					const top = timeToY(it.start);
					const bottom = timeToY(it.end);
					const layout = layoutMap[it.id];
					const totalCols = layout?.colsInGroup || 1;
					const gap = 4;
					const innerWidth = laneWidth - 8;
					const colWidth = (innerWidth - gap * (totalCols - 1)) / totalCols;
					const left =
						centerOffset +
						it.level * laneWidth +
						4 +
						(layout?.col || 0) * (colWidth + gap);
					const width = colWidth;

					return (
						<ScheduleBar
							key={it.id}
							item={it}
							top={top}
							bottom={bottom}
							left={left}
							width={width}
							onMouseEnter={() => setHovered(it)}
							onMouseLeave={() =>
								setHovered((cur) => (cur?.id === it.id ? null : cur))
							}
						/>
					);
				})}

				{hovered && (
					<Tooltip
						item={hovered}
						top={timeToY(hovered.start)}
						left={centerOffset + hovered.level * laneWidth + laneWidth + 12}
					/>
				)}
			</div>

			<Sidebar pxPerHour={pxPerHour} maxLevel={maxLevel} />
		</div>
	);
};
