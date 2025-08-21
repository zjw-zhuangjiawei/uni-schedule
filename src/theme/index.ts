// Theme contract and helpers
export type Mode = "light" | "dark";

export interface Palette {
  primary: string;
  primaryContrast: string;
  background: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  danger: string;
  success: string;
}

export interface ThemeTokens {
  mode: Mode;
  palette: Palette;
  spacing: (step: number) => string;
  radius: {
    sm: string;
    md: string;
    lg: string;
  };
  typography: {
    fontFamily: string;
    baseSize: number;
    scale: (mult: number) => string;
  };
  components?: Record<string, any>;
}

export const defaultSpacing =
  (base = 4) =>
  (step: number) =>
    `${base * step}px`;
