import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  CreateSchedulePayload,
  Schedule,
  QueryScheduleOptions,
} from "../types";

// ---------------------------------------------------------------------------
// In-memory development (non-Tauri) implementation mirroring core semantics.
// This gives a richer fake backend so the UI can be built & tested in the
// browser without the Rust/Tauri process running.
// ---------------------------------------------------------------------------

// Legacy exports for backward compatibility
export type { CreateSchedulePayload } from "../types";
export type ScheduleDto = Schedule;
export interface QueryOptions extends QueryScheduleOptions {}

// Error identifiers aligned (loosely) with Rust ScheduleError variants.
export type ScheduleError =
  | "StartAfterEnd"
  | "LevelExceedsParent"
  | "TimeRangeExceedsParent"
  | "ParentNotFound"
  | "TimeRangeOverlaps"
  | "ScheduleNotFound";

interface InternalSchedule {
  id: string;
  start: Date; // stored as Date for computations
  end: Date;
  level: number;
  exclusive: boolean;
  name: string;
  parents: Set<string>;
  children: Set<string>;
}

// Lightweight interval overlap helper (half-open: [start, end))
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd; // strict half-open semantics
}

class InMemoryScheduleManager {
  private schedules: Map<string, InternalSchedule> = new Map();
  private levelIndex: Map<number, Set<string>> = new Map();

  private generateId(): string {
    // Simple UUID v4-ish fallback (not cryptographically secure) – fine for dev only
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `dev-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  }

  private addToLevelIndex(id: string, level: number) {
    let set = this.levelIndex.get(level);
    if (!set) {
      set = new Set();
      this.levelIndex.set(level, set);
    }
    set.add(id);
  }

  private removeFromLevelIndex(id: string, level: number) {
    const set = this.levelIndex.get(level);
    if (set) {
      set.delete(id);
      if (set.size === 0) this.levelIndex.delete(level);
    }
  }

  private validate(
    payload: CreateSchedulePayload,
    start: Date,
    end: Date,
  ): string | null {
    if (!(start < end)) return "StartAfterEnd";

    // Parent existence & relationship validations
    for (const pid of payload.parents) {
      const p = this.schedules.get(pid);
      if (!p) return "ParentNotFound";
      // Child level must be strictly greater than parent level (Rust comments)
      if (!(payload.level > p.level)) return "LevelExceedsParent";
      if (!(start >= p.start && end <= p.end)) return "TimeRangeExceedsParent";
    }

    // Overlap rules (approximation of Rust logic):
    // 1. Exclusive schedules may not overlap any schedule at the same or lower numeric level.
    // 2. Non-exclusive schedules may not overlap an exclusive schedule at the same or lower level.
    // 3. Overlap at higher parent levels is also disallowed if parent/child exclusivity would be violated; we already ensure containment for parents, so only sibling/cousin conflicts remain.
    for (const existing of this.schedules.values()) {
      if (!overlaps(start, end, existing.start, existing.end)) continue;

      // Same level rule
      if (existing.level === payload.level) {
        if (existing.exclusive || payload.exclusive) return "TimeRangeOverlaps";
      }
      // Lower/equal existing level vs new exclusive
      if (payload.exclusive && existing.level <= payload.level) {
        return "TimeRangeOverlaps";
      }
      // Existing exclusive at lower/equal level blocks new non-exclusive
      if (existing.exclusive && existing.level <= payload.level) {
        return "TimeRangeOverlaps";
      }
    }
    return null;
  }

  create(payload: CreateSchedulePayload): string | string {
    const start = new Date(payload.start);
    const end = new Date(payload.end);
    const err = this.validate(payload, start, end);
    if (err) return err;

    const id = this.generateId();
    const sched: InternalSchedule = {
      id,
      start,
      end,
      level: payload.level,
      exclusive: payload.exclusive,
      name: payload.name,
      parents: new Set(payload.parents),
      children: new Set(),
    };
    this.schedules.set(id, sched);
    for (const pid of payload.parents) {
      const p = this.schedules.get(pid);
      if (p) p.children.add(id);
    }
    this.addToLevelIndex(id, payload.level);
    return id;
  }

  delete(id: string): string | null {
    const sched = this.schedules.get(id);
    if (!sched) return "ScheduleNotFound";
    // Remove child references recursively? For now, we block deletion if it has children to mimic conservative behavior.
    for (const child of sched.children) {
      const c = this.schedules.get(child);
      if (c) {
        // Detach parent link
        c.parents.delete(id);
      }
    }
    for (const parent of sched.parents) {
      const p = this.schedules.get(parent);
      if (p) p.children.delete(id);
    }
    this.removeFromLevelIndex(id, sched.level);
    this.schedules.delete(id);
    return null;
  }

  get(id: string): ScheduleDto | null {
    const s = this.schedules.get(id);
    return s ? this.toDto(s) : null;
  }

  query(opts: QueryOptions): ScheduleDto[] {
    let ids: Iterable<string> = this.schedules.keys();
    if (typeof opts.level === "number") {
      const set = this.levelIndex.get(opts.level);
      ids = set ? set.values() : [];
    }

    const nameFilter = opts.name?.toLowerCase();
    const startFilter = opts.start ? new Date(opts.start) : null;
    const stopFilter = opts.stop ? new Date(opts.stop) : null;
    const exclusiveFilter =
      typeof opts.exclusive === "boolean" ? opts.exclusive : null;

    const out: ScheduleDto[] = [];
    for (const id of ids) {
      const s = this.schedules.get(id)!;
      if (nameFilter && !s.name.toLowerCase().includes(nameFilter)) continue;
      if (exclusiveFilter !== null && s.exclusive !== exclusiveFilter) continue;
      if (startFilter && !(s.start >= startFilter)) continue; // contained semantics
      if (stopFilter && !(s.end <= stopFilter)) continue;
      out.push(this.toDto(s));
    }
    // deterministic ordering: by start then level then name
    out.sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        a.level - b.level ||
        a.name.localeCompare(b.name),
    );
    return out;
  }

  reset() {
    // for tests / hot reload
    this.schedules.clear();
    this.levelIndex.clear();
  }

  private toDto(s: InternalSchedule): ScheduleDto {
    return {
      id: s.id,
      start: s.start.toISOString(),
      end: s.end.toISOString(),
      level: s.level,
      exclusive: s.exclusive,
      name: s.name,
      parents: Array.from(s.parents),
      children: Array.from(s.children),
    };
  }
}

// Singleton manager used only when !isTauri(). Persist across Vite HMR by
// stashing on globalThis. This prevents state loss during UI tweaks.
// We intentionally avoid creating it in Tauri environment.
const g: any = globalThis as any;
let devManager: InMemoryScheduleManager | null = null;
if (!isTauri()) {
  if (!g.__UNI_SCHEDULE_DEV_MANAGER__) {
    g.__UNI_SCHEDULE_DEV_MANAGER__ = new InMemoryScheduleManager();
  }
  devManager = g.__UNI_SCHEDULE_DEV_MANAGER__ as InMemoryScheduleManager;
}

// Accessor (returns null when running under Tauri backend)
export function getDevScheduleManager(): InMemoryScheduleManager | null {
  return devManager;
}

export async function createSchedule(
  payload: CreateSchedulePayload,
): Promise<string> {
  if (isTauri()) {
    return invoke<string>("create_schedule", { payload });
  } else {
    const mgr = devManager!; // non-null: guarded by !isTauri()
    const res = mgr.create(payload);
    if (typeof res !== "string") {
      throw new Error(res);
    }
    return res;
  }
}

export async function deleteSchedule(id: string): Promise<void> {
  if (isTauri()) {
    return invoke<void>("delete_schedule", { id });
  } else {
    const mgr = devManager!;
    const err = mgr.delete(id);
    if (err) throw new Error(err);
  }
}

export async function getSchedule(id: string): Promise<ScheduleDto | null> {
  if (isTauri()) {
    return invoke<ScheduleDto | null>("get_schedule", { id });
  } else {
    return devManager!.get(id);
  }
}

export async function querySchedules(
  opts: QueryOptions = {},
): Promise<ScheduleDto[]> {
  if (isTauri()) {
    return invoke<ScheduleDto[]>("query_schedules", { opts });
  } else {
    return devManager!.query(opts);
  }
}

// Optional utility for dev/testing to seed sample data when NOT using Tauri.
export function devSeedSample(count = 3) {
  if (isTauri()) return; // ignore in prod
  const mgr = devManager!;
  mgr.reset();
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const start = new Date(now + i * 3600_000);
    const end = new Date(start.getTime() + 1800_000);
    mgr.create({
      start: start.toISOString(),
      end: end.toISOString(),
      level: 0,
      exclusive: false,
      name: `Sample ${i + 1}`,
      parents: [],
    });
  }
}
