#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use uni_schedule_lib::commands::{AppState, CreateScheduleReq, CreateScheduleRes, DeleteScheduleReq, DeleteScheduleRes, QueryItem, QueryReq};
use uni_schedule_lib::storage::SledStorage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let storage = SledStorage::open(None);
  let state = AppState::new(storage);

  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .manage(state)
  .invoke_handler(tauri::generate_handler![create_schedule, delete_schedule, query_schedules, get_schedule]);

  builder
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn main() {
  run()
}

#[tauri::command]
async fn create_schedule(state: tauri::State<'_, AppState>, req: CreateScheduleReq) -> Result<CreateScheduleRes, String> {
  uni_schedule_lib::commands::create_schedule(state, req).await
}

#[tauri::command]
async fn delete_schedule(state: tauri::State<'_, AppState>, req: DeleteScheduleReq) -> Result<DeleteScheduleRes, String> {
  uni_schedule_lib::commands::delete_schedule(state, req).await
}

#[tauri::command]
async fn query_schedules(state: tauri::State<'_, AppState>, req: QueryReq) -> Result<Vec<QueryItem>, String> {
  uni_schedule_lib::commands::query_schedules(state, req).await
}

#[tauri::command]
async fn get_schedule(state: tauri::State<'_, AppState>, id: uuid::Uuid) -> Result<Option<QueryItem>, String> {
  uni_schedule_lib::commands::get_schedule(state, id).await
}
