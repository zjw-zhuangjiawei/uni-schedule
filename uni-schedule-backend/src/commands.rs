use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::RwLock;

use uni_schedule_core::schedule::{
  QueryOptions, Schedule, ScheduleId, ScheduleLevel, ScheduleManager,
};

use crate::storage::{SledStorage, Storage};

/// Shared application state containing the schedule manager and storage.
pub struct AppState {
  pub manager: RwLock<ScheduleManager>,
  pub storage: RwLock<SledStorage>,
}

impl AppState {
  pub fn new(storage: SledStorage) -> Self {
    // Start with a default manager, then load persisted state
    let mut mgr = ScheduleManager::new();
    storage.load(&mut mgr);
    Self {
      manager: RwLock::new(mgr),
      storage: RwLock::new(storage),
    }
  }
}

// Request/response DTOs exposed to the frontend.
#[derive(Debug, Deserialize)]
pub struct CreateScheduleReq {
  pub start: DateTime<Utc>,
  pub end: DateTime<Utc>,
  pub level: ScheduleLevel,
  pub exclusive: bool,
  pub name: String,
  pub parents: Vec<ScheduleId>,
}

#[derive(Debug, Serialize)]
pub struct CreateScheduleRes {
  pub id: ScheduleId,
}

#[tauri::command]
pub async fn create_schedule(
  state: State<'_, AppState>,
  req: CreateScheduleReq,
) -> Result<CreateScheduleRes, String> {
  let schedule = Schedule::new(req.start, req.end, req.level, req.exclusive, req.name);
  let parents: HashSet<ScheduleId> = req.parents.into_iter().collect();

  let mut mgr = state.manager.write().await;
  match mgr.create_schedule(schedule, parents) {
    Ok(id) => {
      // persist synchronously
      let snapshot_mgr = &*mgr; // borrow for snapshot
      let mut s = state.storage.write().await;
      s.persist_snapshot(snapshot_mgr);
      Ok(CreateScheduleRes { id })
    }
    Err(e) => Err(e.to_string()),
  }
}

#[derive(Debug, Deserialize)]
pub struct DeleteScheduleReq {
  pub id: ScheduleId,
}

#[derive(Debug, Serialize)]
pub struct DeleteScheduleRes {
  pub removed: Vec<ScheduleId>,
}

#[tauri::command]
pub async fn delete_schedule(
  state: State<'_, AppState>,
  req: DeleteScheduleReq,
) -> Result<DeleteScheduleRes, String> {
  let mut mgr = state.manager.write().await;
  match mgr.delete_schedule(req.id) {
    Ok(set) => {
      let removed: Vec<ScheduleId> = set.into_iter().collect();
      let snapshot_mgr = &*mgr;
      let mut s = state.storage.write().await;
      s.persist_snapshot(snapshot_mgr);
      Ok(DeleteScheduleRes { removed })
    }
    Err(e) => Err(e.to_string()),
  }
}

#[derive(Debug, Deserialize, Default)]
pub struct QueryReq {
  pub name: Option<String>,
  pub start: Option<DateTime<Utc>>,
  pub stop: Option<DateTime<Utc>>,
  pub level: Option<ScheduleLevel>,
  pub exclusive: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct QueryItem {
  pub id: ScheduleId,
  pub start: DateTime<Utc>,
  pub end: DateTime<Utc>,
  pub level: ScheduleLevel,
  pub exclusive: bool,
  pub name: String,
}

#[tauri::command]
pub async fn query_schedules(
  state: State<'_, AppState>,
  req: QueryReq,
) -> Result<Vec<QueryItem>, String> {
  let mgr = state.manager.read().await;
  let opts = QueryOptions {
    name: req.name,
    start: req.start,
    stop: req.stop,
    level: req.level,
    exclusive: req.exclusive,
    matcher: None,
  };
  let res = mgr.query_schedule(opts);
  let items = res
    .into_iter()
    .map(|(id, s)| QueryItem {
      id,
      start: s.start(),
      end: s.end(),
      level: s.level(),
      exclusive: s.exclusive(),
      name: s.name().to_string(),
    })
    .collect();
  Ok(items)
}

#[tauri::command]
pub async fn get_schedule(
  state: State<'_, AppState>,
  id: ScheduleId,
) -> Result<Option<QueryItem>, String> {
  let mgr = state.manager.read().await;
  let opt = mgr.get_schedule(id).cloned();
  Ok(opt.map(|s| QueryItem {
    id,
    start: s.start(),
    end: s.end(),
    level: s.level(),
    exclusive: s.exclusive(),
    name: s.name().to_string(),
  }))
}

/// Helper to register all Tauri command handlers on a `tauri::Builder`.
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
  builder.invoke_handler(tauri::generate_handler![
    create_schedule,
    delete_schedule,
    query_schedules,
    get_schedule,
  ])
}
