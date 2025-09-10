#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use uni_schedule_lib::commands::{register, AppState};
use uni_schedule_lib::storage::SledStorage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let storage = SledStorage::open(None);
  let state = AppState::new(storage);

  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .manage(state);

  // register command handlers defined in the library
  let builder = register(builder);

  builder
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn main() {
  run()
}
