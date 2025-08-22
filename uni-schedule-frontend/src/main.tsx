import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppThemeProvider } from "./theme/EmotionThemeProvider";
import { useThemeMode } from "./hooks";
import MUIAdapterProvider from "./theme/muiAdapter";
import { lightTheme, darkTheme } from "./theme/themes";

// Small wrapper to manage theme mode using our hook
const Root: React.FC = () => {
  const { mode } = useThemeMode();
  const tokens = mode === "light" ? lightTheme : darkTheme;

  return (
    <AppThemeProvider mode={mode}>
      <MUIAdapterProvider tokens={tokens}>
        <App />
      </MUIAdapterProvider>
    </AppThemeProvider>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
