import { invoke } from "@tauri-apps/api/core";
import { isTauriAvailable } from "./tauri";

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

// isTauriAvailable moved to src/utils/tauri.ts

export async function createSchedule(
  payload: CreateSchedulePayload,
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
  opts: QueryOptions = {},
): Promise<ScheduleDto[]> {
  if (isTauriAvailable()) {
    return invoke<ScheduleDto[]>("query_schedules", { opts });
  } else {
    console.log("🔧 Using fake data for querySchedules (Tauri not available)");
    return fakeQuerySchedules(opts);
  }
}

// --- Minimal fake implementations used in non-Tauri environments ---
// These are intentionally small and synchronous to keep dev UX simple.
function fakeCreateSchedule(_payload: CreateSchedulePayload): string {
  // return a pseudo-random id
  return `fake-${Math.random().toString(36).slice(2, 10)}`;
}

function fakeDeleteSchedule(_id: string): void {
  // no-op in fake environment
}

function fakeGetSchedule(id: string): ScheduleDto | null {
  // return a simple mocked schedule or null
  return {
    id,
    start: new Date().toISOString(),
    end: new Date(Date.now() + 3600_000).toISOString(),
    level: 0,
    exclusive: false,
    name: "Fake schedule",
  };
}

function fakeQuerySchedules(_opts: QueryOptions = {}): ScheduleDto[] {
  return [
    {
      id: "fake-1",
      start: new Date().toISOString(),
      end: new Date(Date.now() + 3600_000).toISOString(),
      level: 0,
      exclusive: false,
      name: "Fake schedule 1",
    },
  ];
}
