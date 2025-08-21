import { useEffect, useState } from "react";

const STORAGE_KEY = "app:theme-mode";

export const useThemeMode = () => {
  const [mode, setMode] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") return stored;
    } catch {}
    if (window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "light";
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {}
    document.documentElement.setAttribute("data-theme", mode);
    // Broadcast theme change so other hook instances can sync
    try {
      document.dispatchEvent(
        new CustomEvent("app:theme-change", { detail: { mode } }),
      );
    } catch {}
  }, [mode]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) setMode(e.matches ? "dark" : "light");
      } catch {}
    };
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  // Listen for theme changes dispatched from other hook instances and sync
  useEffect(() => {
    const onThemeChange = (e: Event) => {
      try {
        // event may be a CustomEvent with detail.mode
        const ce = e as CustomEvent<{ mode: "light" | "dark" }>;
        if (ce?.detail?.mode && ce.detail.mode !== mode) {
          setMode(ce.detail.mode);
        }
      } catch {}
    };

    document.addEventListener(
      "app:theme-change",
      onThemeChange as EventListener,
    );
    return () =>
      document.removeEventListener(
        "app:theme-change",
        onThemeChange as EventListener,
      );
  }, [mode]);

  const toggle = () => setMode((m) => (m === "dark" ? "light" : "dark"));

  return { mode, setMode, toggle };
};
