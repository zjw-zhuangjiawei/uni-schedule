import React, { useMemo } from "react";
import {
  ThemeProvider as EmotionThemeBaseProvider,
  Global,
  css,
} from "@emotion/react";
import { createTheme } from "./themes";
import type { ThemeTokens } from "./index";

interface Props {
  mode: "light" | "dark";
  children: React.ReactNode;
  overrides?: Partial<ThemeTokens>;
}

const themeToCssVars = (theme: ThemeTokens) => {
  const vars: Record<string, string> = {};
  const p = theme.palette;
  vars["--color-primary"] = p.primary;
  vars["--color-primary-contrast"] = p.primaryContrast;
  vars["--color-bg"] = p.background;
  vars["--color-surface"] = p.surface;
  vars["--color-text-primary"] = p.textPrimary;
  vars["--color-text-secondary"] = p.textSecondary;
  vars["--color-border"] = p.border;
  vars["--radius-sm"] = theme.radius.sm;
  vars["--radius-md"] = theme.radius.md;
  vars["--radius-lg"] = theme.radius.lg;
  vars["--spacing-1"] = theme.spacing(1);
  vars["--spacing-2"] = theme.spacing(2);
  return vars;
};

export const AppThemeProvider: React.FC<Props> = ({
  mode,
  children,
  overrides,
}) => {
  const baseTheme = createTheme(mode);
  const theme = { ...baseTheme, ...(overrides || {}) };
  const cssVars = useMemo(() => themeToCssVars(theme), [theme]);

  return (
    <EmotionThemeBaseProvider theme={theme}>
      <Global
        styles={css`
          html[data-theme="${mode}"] {
            ${Object.entries(cssVars)
              .map(([k, v]) => `${k}: ${v};`)
              .join("\n")}
            background: var(--color-bg);
            color: var(--color-text-primary);
          }

          body {
            margin: 0;
            font-family: ${theme.typography.fontFamily};
            background: var(--color-bg);
            color: var(--color-text-primary);
          }
        `}
      />
      {children}
    </EmotionThemeBaseProvider>
  );
};
