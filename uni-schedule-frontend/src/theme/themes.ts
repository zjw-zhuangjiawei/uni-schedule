import { ThemeTokens, defaultSpacing, Mode } from "./index";

const baseRadius = {
  sm: "4px",
  md: "8px",
  lg: "12px",
};

const baseTypography = {
  fontFamily:
    '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
  baseSize: 14,
  scale: (mult: number) => `${14 * mult}px`,
};

function makePalette(mode: Mode) {
  if (mode === "light") {
    return {
      primary: "#2b8cf4",
      primaryContrast: "#ffffff",
      background: "#ffffff",
      surface: "#f8fafc",
      textPrimary: "#333333",
      textSecondary: "#6c757d",
      border: "#e2e8f0",
      danger: "#dc3545",
      success: "#28a745",
    } as const;
  }
  return {
    primary: "#60a5fa",
    primaryContrast: "#0b1220",
    background: "#1e1e23",
    surface: "#282830",
    textPrimary: "#f5f5f5",
    textSecondary: "#999999",
    border: "#3a3f46",
    danger: "#f87171",
    success: "#34d399",
  } as const;
}

export const createTheme = (mode: Mode): ThemeTokens => {
  const palette = makePalette(mode);
  return {
    mode,
    palette,
    spacing: defaultSpacing(4),
    radius: baseRadius,
    typography: baseTypography,
    components: {
      Button: {
        variant: {
          primary: {
            bg: palette.primary,
            color: palette.primaryContrast,
            border: palette.primary,
          },
          secondary: {
            bg: "transparent",
            color: palette.textPrimary,
            border: palette.border,
          },
          danger: {
            bg: palette.danger,
            color: "#ffffff",
            border: palette.danger,
          },
        },
        size: {
          small: {
            fontSize: "12px",
            padding: `${defaultSpacing(4)(1)} ${defaultSpacing(4)(2)}`,
          },
          medium: {
            fontSize: "14px",
            padding: `${defaultSpacing(4)(2)} ${defaultSpacing(4)(4)}`,
          },
          large: {
            fontSize: "16px",
            padding: `${defaultSpacing(4)(3)} ${defaultSpacing(4)(6)}`,
          },
        },
      },
    },
  };
};

export const lightTheme = createTheme("light");
export const darkTheme = createTheme("dark");
