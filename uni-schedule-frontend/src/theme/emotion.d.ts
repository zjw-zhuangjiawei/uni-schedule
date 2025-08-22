import "@emotion/react";
import type { ThemeTokens } from "./index";

declare module "@emotion/react" {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  export interface Theme extends ThemeTokens {}
}
