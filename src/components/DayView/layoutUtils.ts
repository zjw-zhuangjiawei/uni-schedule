import type {
	ScheduleItem,
	LayoutResult,
	LayoutGroup,
	LayoutMapEntry,
} from "./types";

export function computeLayout(
	items: ScheduleItem[],
	aggregateThreshold: number
): LayoutResult {
	if (items.length === 0) return { groups: [], layoutMap: {}, maxLevel: 0 };

	const maxLevel = items.reduce((m, it) => Math.max(m, it.level), 0);
	const layoutMap: Record<string, LayoutMapEntry> = {};
	const groups: LayoutGroup[] = [];

	for (let level = 0; level <= maxLevel; level++) {
		const levelItems = items
			.filter((i) => i.level === level)
			.sort((a, b) => a.start.getTime() - b.start.getTime());

		if (levelItems.length === 0) continue;

		interface ActiveCol {
			end: number;
			col: number;
			id: string;
		}

		let active: ActiveCol[] = [];
		let groupIdx = -1;
		let currentGroupItemIds: string[] = [];
		let currentGroupStart = 0;
		let currentGroupEnd = 0;
		let currentGroupMaxCol = -1;

		const closeGroup = () => {
			if (currentGroupItemIds.length === 0) return;

			const gId = `lvl-${level}-g${groupIdx}`;
			const aggregate = currentGroupItemIds.length > aggregateThreshold;

			groups.push({
				id: gId,
				level,
				itemIds: currentGroupItemIds.slice(),
				start: new Date(currentGroupStart),
				end: new Date(currentGroupEnd),
				maxCols: currentGroupMaxCol + 1,
				aggregate,
			});

			// Patch layoutMap with groupId and colsInGroup
			for (const id of currentGroupItemIds) {
				layoutMap[id].colsInGroup = currentGroupMaxCol + 1;
				layoutMap[id].groupId = gId;
			}
		};

		for (const it of levelItems) {
			const startMs = it.start.getTime();
			// remove finished
			active = active.filter((a) => a.end > startMs);
			const groupEmptyBefore = active.length === 0;

			if (groupEmptyBefore) {
				// finish previous group
				closeGroup();
				// start new group
				groupIdx += 1;
				currentGroupItemIds = [];
				currentGroupStart = startMs;
				currentGroupEnd = it.end.getTime();
				currentGroupMaxCol = -1;
			}

			// assign column
			let assignedCol = 0;
			while (active.some((a) => a.col === assignedCol)) assignedCol++;

			active.push({ end: it.end.getTime(), col: assignedCol, id: it.id });
			currentGroupItemIds.push(it.id);
			currentGroupEnd = Math.max(currentGroupEnd, it.end.getTime());
			currentGroupMaxCol = Math.max(currentGroupMaxCol, assignedCol);
			layoutMap[it.id] = { col: assignedCol, colsInGroup: 0, groupId: "" };
		}

		// close final group
		closeGroup();
	}

	return { groups, layoutMap, maxLevel };
}
