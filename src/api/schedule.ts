import { invoke } from "@tauri-apps/api/core";

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

export async function createSchedule(
	payload: CreateSchedulePayload
): Promise<string> {
	return invoke<string>("create_schedule", { payload });
}

export async function deleteSchedule(id: string): Promise<void> {
	return invoke<void>("delete_schedule", { id });
}

export async function getSchedule(id: string): Promise<ScheduleDto | null> {
	return invoke<ScheduleDto | null>("get_schedule", { id });
}

export async function querySchedules(
	opts: QueryOptions = {}
): Promise<ScheduleDto[]> {
	return invoke<ScheduleDto[]>("query_schedules", { opts });
}
