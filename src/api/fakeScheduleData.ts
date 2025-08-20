import type {
	ScheduleDto,
	CreateSchedulePayload,
	QueryOptions,
} from "./schedule";

// Fake data generator for debugging without Tauri backend
// Based on unit tests in schedule.rs

let fakeSchedules: ScheduleDto[] = [];
let nextId = 1;

// Generate UUID-like strings for IDs
function generateId(): string {
	return `fake-schedule-${nextId++}`;
}

// Create some realistic fake data similar to the unit tests
function createFakeSchedules(): ScheduleDto[] {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	return [
		{
			id: generateId(),
			name: "Morning Lecture",
			start: new Date(today.getTime() + 8 * 60 * 60 * 1000).toISOString(), // 8:00 AM
			end: new Date(today.getTime() + 10 * 60 * 60 * 1000).toISOString(), // 10:00 AM
			level: 1,
			exclusive: true,
		},
		{
			id: generateId(),
			name: "Study Session",
			start: new Date(today.getTime() + 10.5 * 60 * 60 * 1000).toISOString(), // 10:30 AM
			end: new Date(today.getTime() + 12 * 60 * 60 * 1000).toISOString(), // 12:00 PM
			level: 2,
			exclusive: false,
		},
		{
			id: generateId(),
			name: "Lunch Break",
			start: new Date(today.getTime() + 12 * 60 * 60 * 1000).toISOString(), // 12:00 PM
			end: new Date(today.getTime() + 13 * 60 * 60 * 1000).toISOString(), // 1:00 PM
			level: 0,
			exclusive: true,
		},
		{
			id: generateId(),
			name: "Lab Work",
			start: new Date(today.getTime() + 14 * 60 * 60 * 1000).toISOString(), // 2:00 PM
			end: new Date(today.getTime() + 17 * 60 * 60 * 1000).toISOString(), // 5:00 PM
			level: 1,
			exclusive: false,
		},
		{
			id: generateId(),
			name: "Group Meeting",
			start: new Date(today.getTime() + 15 * 60 * 60 * 1000).toISOString(), // 3:00 PM
			end: new Date(today.getTime() + 16 * 60 * 60 * 1000).toISOString(), // 4:00 PM
			level: 3,
			exclusive: false,
		},
		{
			id: generateId(),
			name: "Evening Study",
			start: new Date(today.getTime() + 19 * 60 * 60 * 1000).toISOString(), // 7:00 PM
			end: new Date(today.getTime() + 21 * 60 * 60 * 1000).toISOString(), // 9:00 PM
			level: 2,
			exclusive: false,
		},
		{
			id: generateId(),
			name: "Quick Review",
			start: new Date(today.getTime() + 21.5 * 60 * 60 * 1000).toISOString(), // 9:30 PM
			end: new Date(today.getTime() + 22.5 * 60 * 60 * 1000).toISOString(), // 10:30 PM
			level: 4,
			exclusive: false,
		},
	];
}

// Initialize fake data
function initializeFakeData() {
	if (fakeSchedules.length === 0) {
		fakeSchedules = createFakeSchedules();
	}
}

// Fake API functions that match the real API interface
export async function fakeCreateSchedule(
	payload: CreateSchedulePayload
): Promise<string> {
	initializeFakeData();

	// Simulate some validation like in the unit tests
	const start = new Date(payload.start);
	const end = new Date(payload.end);

	if (start >= end) {
		throw new Error("StartAfterEnd");
	}

	// Check for overlaps if exclusive (simplified version of the real logic)
	if (payload.exclusive) {
		const overlapping = fakeSchedules.filter((schedule) => {
			const schedStart = new Date(schedule.start);
			const schedEnd = new Date(schedule.end);

			// Check for overlap: schedule starts before our end AND schedule ends after our start
			const hasOverlap = schedStart < end && schedEnd > start;

			// Only block if there's overlap and the existing schedule is exclusive or same/lower level
			return (
				hasOverlap && (schedule.exclusive || schedule.level <= payload.level)
			);
		});

		if (overlapping.length > 0) {
			throw new Error("TimeRangeOverlaps");
		}
	}

	const newSchedule: ScheduleDto = {
		id: generateId(),
		name: payload.name,
		start: payload.start,
		end: payload.end,
		level: payload.level,
		exclusive: payload.exclusive,
	};

	fakeSchedules.push(newSchedule);

	// Simulate async behavior
	await new Promise((resolve) => setTimeout(resolve, 100));

	return newSchedule.id;
}

export async function fakeDeleteSchedule(id: string): Promise<void> {
	initializeFakeData();

	const index = fakeSchedules.findIndex((schedule) => schedule.id === id);
	if (index === -1) {
		throw new Error("ScheduleNotFound");
	}

	fakeSchedules.splice(index, 1);

	// Simulate async behavior
	await new Promise((resolve) => setTimeout(resolve, 50));
}

export async function fakeGetSchedule(id: string): Promise<ScheduleDto | null> {
	initializeFakeData();

	const schedule = fakeSchedules.find((s) => s.id === id);

	// Simulate async behavior
	await new Promise((resolve) => setTimeout(resolve, 50));

	return schedule || null;
}

export async function fakeQuerySchedules(
	opts: QueryOptions = {}
): Promise<ScheduleDto[]> {
	initializeFakeData();

	let results = [...fakeSchedules];

	// Apply filters based on QueryOptions (similar to the real implementation)
	if (opts.name) {
		results = results.filter((schedule) =>
			schedule.name.toLowerCase().includes(opts.name!.toLowerCase())
		);
	}

	if (opts.level !== undefined) {
		results = results.filter((schedule) => schedule.level === opts.level);
	}

	if (opts.exclusive !== undefined) {
		results = results.filter(
			(schedule) => schedule.exclusive === opts.exclusive
		);
	}

	if (opts.start && opts.stop) {
		const queryStart = new Date(opts.start);
		const queryStop = new Date(opts.stop);

		results = results.filter((schedule) => {
			const schedStart = new Date(schedule.start);
			const schedEnd = new Date(schedule.end);

			// Check for overlap with query range
			return schedStart < queryStop && schedEnd > queryStart;
		});
	}

	// Sort by start time (like in the hooks)
	results.sort(
		(a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
	);

	// Simulate async behavior
	await new Promise((resolve) => setTimeout(resolve, 200));

	return results;
}

// Function to reset fake data (useful for testing)
export function resetFakeData() {
	fakeSchedules = [];
	nextId = 1;
}

// Function to add more fake data for testing different scenarios
export function addTestScenarios() {
	initializeFakeData();

	const now = new Date();
	const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

	// Add some scenarios similar to unit tests
	const additionalSchedules: Omit<ScheduleDto, "id">[] = [
		{
			name: "Overlapping Test A",
			start: new Date(tomorrow.getTime() + 9 * 60 * 60 * 1000).toISOString(),
			end: new Date(tomorrow.getTime() + 11 * 60 * 60 * 1000).toISOString(),
			level: 1,
			exclusive: true,
		},
		{
			name: "Overlapping Test B",
			start: new Date(tomorrow.getTime() + 10 * 60 * 60 * 1000).toISOString(),
			end: new Date(tomorrow.getTime() + 12 * 60 * 60 * 1000).toISOString(),
			level: 2,
			exclusive: false,
		},
		{
			name: "High Level Task",
			start: new Date(tomorrow.getTime() + 13 * 60 * 60 * 1000).toISOString(),
			end: new Date(tomorrow.getTime() + 14 * 60 * 60 * 1000).toISOString(),
			level: 5,
			exclusive: false,
		},
	];

	additionalSchedules.forEach((schedule) => {
		fakeSchedules.push({
			...schedule,
			id: generateId(),
		});
	});
}
