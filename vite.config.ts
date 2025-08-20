import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
	plugins: [react()],
	clearScreen: false,
	server: {
		port: 31420,
		strictPort: true,
		host: host || "0.0.0.0",
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 31421,
			  }
			: undefined,
		watch: {
			// 3. tell Vite to ignore watching `src-tauri`
			ignored: ["**/src-tauri/**"],
		},
	},
}));
