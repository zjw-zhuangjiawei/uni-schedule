/// <reference types="vitest" />

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 31420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 31421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching backend/tauri sources after refactor
      ignored: ["**/uni-schedule-backend/**", "**/src-tauri/**"],
    },
  },
  // Vitest configuration
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{js,ts,jsx,tsx}"],
    exclude: ["node_modules", "dist"],
    setupFiles: ["./vitest.setup.ts"],
    timeout: 5000,
    environmentOptions: {
      jsdom: {
        url: "http://localhost",
      },
    },
    coverage: {
      provider: "v8" as const,
      reporter: ["text", "lcov"],
      exclude: ["src/**/mocks/**"],
    },
  },
}));
