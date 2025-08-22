import React, { useMemo } from "react";
import { ThemeProvider as MuiThemeProvider, CssBaseline } from "@mui/material";
import {
  createTheme as createMuiTheme,
  responsiveFontSizes,
} from "@mui/material/styles";
import type { ThemeTokens } from "./index";

// Helper to parse values like '8px' into numbers
function parsePx(value?: string | number) {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const n = parseInt(value.toString(), 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Create an MUI theme from the project's ThemeTokens.
 * This function maps the common token groups (palette, typography, spacing, radius)
 * into MUI's theme shape. Keep the mapping minimal and conservative.
 */
export function createMuiThemeFromTokens(tokens: ThemeTokens) {
  const baseSpacing =
    typeof tokens.spacing === "function" ? parsePx(tokens.spacing(1)) : 8;

  const muiTheme = createMuiTheme({
    palette: {
      mode: tokens.mode,
      primary: {
        main: tokens.palette.primary,
        contrastText: tokens.palette.primaryContrast,
      },
      background: {
        default: tokens.palette.background,
        paper: tokens.palette.surface,
      },
      text: {
        primary: tokens.palette.textPrimary,
        secondary: tokens.palette.textSecondary,
      },
      divider: tokens.palette.border,
      success: { main: tokens.palette.success },
      error: { main: tokens.palette.danger },
    },
    typography: {
      fontFamily: tokens.typography.fontFamily,
      fontSize: tokens.typography.baseSize,
    },
    spacing: baseSpacing,
    shape: {
      borderRadius: parsePx(tokens.radius.md),
    },
    components: {
      // Small, conservative Button mapping to keep visuals consistent
      MuiButton: {
        styleOverrides: {
          root: ({ ownerState }: any) => ({
            textTransform: "none",
            borderRadius: parsePx(tokens.radius.sm),
            // Outlined buttons should use token border and text colors
            ...(ownerState?.variant === "outlined" && {
              borderColor: tokens.palette.border,
              color: tokens.palette.textPrimary,
            }),
            // Contained primary should use primary token colors
            ...(ownerState?.variant === "contained" &&
              ownerState?.color === "primary" && {
                backgroundColor: tokens.palette.primary,
                color: tokens.palette.primaryContrast,
              }),
            // Contained error/danger
            ...(ownerState?.variant === "contained" &&
              ownerState?.color === "error" && {
                backgroundColor: tokens.palette.danger,
                color: "#ffffff",
              }),
          }),
        },
      },
    },
  });

  return responsiveFontSizes(muiTheme);
}

/**
 * Provider component to apply the adapted MUI theme.
 * Usage: wrap your app with <MUIAdapterProvider tokens={themeTokens}>...
 */
export const MUIAdapterProvider: React.FC<{
  tokens: ThemeTokens;
  children: React.ReactNode;
}> = ({ tokens, children }) => {
  const muiTheme = useMemo(() => createMuiThemeFromTokens(tokens), [tokens]);

  return (
    <MuiThemeProvider theme={muiTheme}>
      <CssBaseline />
      {children}
    </MuiThemeProvider>
  );
};

export default MUIAdapterProvider;
