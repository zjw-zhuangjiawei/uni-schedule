/**
 * Converts a string or Date to a Date object
 */
export function toDate(date: string | Date): Date {
  return date instanceof Date ? date : new Date(date);
}

/**
 * Formats a date to ISO local datetime string for input fields
 */
export function toISOLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Calculates the number of days between two dates
 */
export function daysBetween(start: Date, end: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const startTime = start.setHours(0, 0, 0, 0);
  const endTime = new Date(end).setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((endTime - startTime) / msPerDay));
}

/**
 * Clamps days to ensure non-negative values
 */
export function clampDays(days: number): number {
  return Math.max(0, Math.ceil(days));
}

/**
 * Calculates the day index from a start date
 */
export function getDayIndex(date: Date, startDate: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return clampDays(
    (date.setHours(0, 0, 0, 0) - new Date(startDate).setHours(0, 0, 0, 0)) /
      msPerDay,
  );
}

/**
 * Calculates duration in days between start and end dates
 */
export function getDurationDays(start: Date, end: Date): number {
  return daysBetween(start, end) + 1;
}
