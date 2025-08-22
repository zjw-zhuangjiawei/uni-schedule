//! Global constants and helper functions for configuration & default paths.
//!
//! This module centralizes tunable constants (storage paths, filenames,
//! index subdirectories, thresholds, etc.) so future changes only need to
//! touch one place. Keep items small & composable; avoid side effects on import.

use std::path::PathBuf;

/// Directory name (under the user data directory) used for persistent data.
/// Example final path (Linux): `~/.local/share/uni-schedule`.
pub const APP_DIR_NAME: &str = "uni-schedule";

// Full-text search functionality disabled
// /// Subdirectory for Tantivy full‑text index inside the app data directory.
// pub const FT_SUBDIR: &str = "tantivy";

/// Primary schedules database file name (native_db will create / manage it).
/// Stored directly under the app data directory.
pub const SCHEDULE_DB_FILE: &str = "schedules.db";

// Full-text search functionality disabled
// /// Threshold for committing full‑text writer operations (mirrors logic in schedule.rs).
// pub const FT_COMMIT_THRESHOLD: usize = 32;

/// Return the base application data directory path (platform aware).
/// Fallback is current working directory if a standard location isn't available.
pub fn app_data_dir() -> PathBuf {
  // Prefer OS specific data dir: Linux/XDG, macOS, Windows.
  dirs::data_dir()
    .unwrap_or_else(|| PathBuf::from("."))
    .join(APP_DIR_NAME)
}

/// Full path to the native_db schedule storage file.
pub fn default_storage_file() -> PathBuf {
  app_data_dir().join(SCHEDULE_DB_FILE)
}

// Full-text search functionality disabled
// /// Full path to the Tantivy index directory.
// pub fn default_tantivy_dir() -> PathBuf {
// 	app_data_dir().join(FT_SUBDIR)
// }

/// Convenience: path passed to `ScheduleManager::new_from_storage` (directory, not file).
/// We give the parent directory so the manager / storage layer can decide structure.
pub fn default_storage_path() -> PathBuf {
  app_data_dir()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn paths_are_consistent() {
    let base = app_data_dir();
    assert!(default_storage_file().starts_with(&base));
    // Full-text search functionality disabled
    // assert!(default_tantivy_dir().starts_with(&base));
  }
}
