export interface ScheduleItem {
	id: string;
	name: string;
	start: Date;
	end: Date;
	level: number;
	exclusive: boolean;
}

export interface GanttProps {
	items: ScheduleItem[];
	pxPerHour: number;
}

export interface LayoutGroup {
	id: string;
	level: number;
	itemIds: string[];
	start: Date; // earliest start
	end: Date; // latest end
	maxCols: number; // number of columns needed when expanded
	aggregate: boolean; // show as aggregate when not expanded
}

export interface LayoutMapEntry {
	col: number;
	colsInGroup: number;
	groupId: string;
}

export interface LayoutResult {
	groups: LayoutGroup[];
	layoutMap: Record<string, LayoutMapEntry>;
	maxLevel: number;
}

export interface FormState {
	name: string;
	start: string;
	durationHours: number;
	level: number;
	exclusive: boolean;
}
