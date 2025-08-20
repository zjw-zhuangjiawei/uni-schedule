import { invoke } from "@tauri-apps/api/core";
import {
	fakeCreateSchedule,
	fakeDeleteSchedule,
	fakeGetSchedule,
	fakeQuerySchedules,
} from "./fakeScheduleData";

export interface CreateSchedulePayload {
	start: string; // ISO 8601
	end: string; // ISO 8601
	level: number;
	exclusive: boolean;
	name: string;
	parents: string[];
}

export interface ScheduleDto {
	id: string;
	start: string;
	end: string;
	level: number;
	exclusive: boolean;
	name: string;
}

export interface QueryOptions {
	name?: string;
	start?: string; // ISO
	stop?: string; // ISO
	level?: number;
	exclusive?: boolean;
}

// Check if we're running in Tauri environment
function isTauriAvailable(): boolean {
	try {
		// Check if window.__TAURI__ exists (Tauri injects this)
		return typeof window !== "undefined" && "__TAURI__" in window;
	} catch {
		return false;
	}
}

export async function createSchedule(
	payload: CreateSchedulePayload
): Promise<string> {
	if (isTauriAvailable()) {
		return invoke<string>("create_schedule", { payload });
	} else {
		console.log("🔧 Using fake data for createSchedule (Tauri not available)");
		return fakeCreateSchedule(payload);
	}
}

export async function deleteSchedule(id: string): Promise<void> {
	if (isTauriAvailable()) {
		return invoke<void>("delete_schedule", { id });
	} else {
		console.log("🔧 Using fake data for deleteSchedule (Tauri not available)");
		return fakeDeleteSchedule(id);
	}
}

export async function getSchedule(id: string): Promise<ScheduleDto | null> {
	if (isTauriAvailable()) {
		return invoke<ScheduleDto | null>("get_schedule", { id });
	} else {
		console.log("🔧 Using fake data for getSchedule (Tauri not available)");
		return fakeGetSchedule(id);
	}
}

export async function querySchedules(
	opts: QueryOptions = {}
): Promise<ScheduleDto[]> {
	if (isTauriAvailable()) {
		return invoke<ScheduleDto[]>("query_schedules", { opts });
	} else {
		console.log("🔧 Using fake data for querySchedules (Tauri not available)");
		return fakeQuerySchedules(opts);
	}
}
