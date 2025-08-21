/**
 * Generates a deterministic color for a schedule based on ID and level
 */
export function generateScheduleColor(id: string, level: number): string {
  const base = [...id].reduce(
    (accumulator, char) => (accumulator * 33 + char.charCodeAt(0)) >>> 0,
    level + 17,
  );
  const hue = base % 360;
  return `hsl(${hue} 70% 55%)`;
}

/**
 * Gets a slightly darker version of a color for better contrast
 */
export function getDarkerColor(id: string, level: number): string {
  const base = [...id].reduce(
    (accumulator, char) => (accumulator * 33 + char.charCodeAt(0)) >>> 0,
    level + 17,
  );
  const hue = base % 360;
  return `hsl(${hue} 70% 45%)`;
}

/**
 * Predefined color palette for consistent theming
 */
export const COLORS = {
  primary: "#2b8cf4",
  secondary: "#6c757d",
  success: "#28a745",
  danger: "#dc3545",
  warning: "#ffc107",
  info: "#17a2b8",
  light: "#f8f9fa",
  dark: "#343a40",
  background: {
    primary: "#ffffff",
    secondary: "#f8f9fa",
    dark: "#1e1e23",
    panel: "#282830",
  },
  text: {
    primary: "#333333",
    secondary: "#6c757d",
    light: "#f5f5f5",
    muted: "#999999",
  },
  border: {
    light: "#e6e6e6",
    medium: "#cccccc",
    dark: "#999999",
  },
} as const;
