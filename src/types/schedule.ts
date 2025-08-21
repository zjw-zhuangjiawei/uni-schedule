// Core schedule types
export interface Schedule {
  id: string;
  name: string;
  start: string; // ISO 8601 format
  end: string; // ISO 8601 format
  level: number;
  exclusive: boolean;
  parents?: string[];
  children?: string[];
}

export interface CreateSchedulePayload {
  name: string;
  start: string; // ISO 8601 format
  end: string; // ISO 8601 format
  level: number;
  exclusive: boolean;
  parents: string[];
}

export interface QueryScheduleOptions {
  name?: string;
  start?: string; // ISO 8601 format
  stop?: string; // ISO 8601 format
  level?: number;
  exclusive?: boolean;
}

export interface ScheduleError {
  type:
    | "StartAfterEnd"
    | "LevelExceedsParent"
    | "TimeRangeExceedsParent"
    | "ParentNotFound"
    | "TimeRangeOverlaps"
    | "ScheduleNotFound";
  message: string;
}

// UI-specific types
export interface GanttTask {
  id: string;
  title: string;
  start: string | Date;
  end: string | Date;
  color?: string;
}

export interface DateRange {
  start: string | Date;
  end: string | Date;
}

export interface LoadingState {
  isLoading: boolean;
  error: string | null;
}
