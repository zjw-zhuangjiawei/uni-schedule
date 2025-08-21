// Utility to detect if the app is running inside a Tauri environment.
// Kept tiny and dependency-free so it can be used anywhere in the web frontend.
export function isTauriAvailable(): boolean {
  try {
    // Tauri injects a global __TAURI__ object into window when available
    return typeof window !== "undefined" && "__TAURI__" in window;
  } catch {
    return false;
  }
}
