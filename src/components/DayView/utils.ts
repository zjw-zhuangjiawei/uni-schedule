import type { ScheduleDto } from "../../api/schedule";
import type { ScheduleItem } from "./types";

export const HOUR_MS = 3600_000;
export const AGGREGATE_THRESHOLD = 5; // 并发数超过此值使用聚合条

export const levelColors = [
	"#2563eb", // level 0
	"#16a34a", // level 1
	"#d97706", // level 2
	"#9333ea", // level 3
	"#dc2626", // level 4
];

export function toItem(dto: ScheduleDto): ScheduleItem {
	return {
		id: dto.id,
		name: dto.name,
		start: new Date(dto.start),
		end: new Date(dto.end),
		level: dto.level,
		exclusive: dto.exclusive,
	};
}

export function colorFor(item: ScheduleItem): string {
	const base = levelColors[item.level % levelColors.length];
	if (!item.exclusive) return base;
	// Slight transform for exclusive (add pattern-ish via linear-gradient in style)
	return base;
}

export function formatTime(d: Date): string {
	return d.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

export function createDefaultStartTime(): string {
	const d = new Date();
	d.setMinutes(0, 0, 0);
	return d.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm
}
