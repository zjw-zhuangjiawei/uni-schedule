use crate::storage::data::v1::ScheduleModel as PersistSchedule;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
  collections::{HashMap, HashSet},
  path::PathBuf,
};
use thiserror::Error;
use uni_schedule_core::schedule::{
  Schedule, ScheduleError as CoreScheduleError, ScheduleLevel,
  ScheduleManager as CoreScheduleManager,
};

// Re-export core types for backward compatibility
pub use uni_schedule_core::schedule::{QueryOptions, ScheduleId};

/// Backend-specific error type that wraps core errors and storage errors
#[derive(Debug, Error)]
pub enum BackendScheduleError {
  #[error("Core schedule error: {0}")]
  CoreError(#[from] CoreScheduleError),

  #[error("Storage error: {0}")]
  StorageError(String),
}

// ---------- Tauri command interface ----------
// Provide a global, synchronized ScheduleManager for Tauri commands.
pub mod tauri_api {
  use super::*;
  use once_cell::sync::Lazy;
  use std::sync::RwLock;

  #[cfg(not(debug_assertions))]
  static MANAGER: Lazy<RwLock<ScheduleManager>> = Lazy::new(|| {
    let path = crate::option::default_storage_path();
    RwLock::new(ScheduleManager::new_from_storage(Some(path)))
  });

  #[cfg(debug_assertions)]
  static MANAGER: Lazy<RwLock<ScheduleManager>> =
    Lazy::new(|| RwLock::new(ScheduleManager::new_from_storage(None))); // In memory for debugging

  #[derive(Serialize, Deserialize, Debug)]
  pub struct CreateSchedulePayload {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub level: ScheduleLevel,
    pub exclusive: bool,
    pub name: String,
    // Wire format: use String (UUID) for IDs when communicating over IPC
    pub parents: Vec<String>,
  }

  #[derive(Serialize, Deserialize, Debug)]
  pub struct ScheduleDto {
    // Wire representation: String (UUID) for IPC/JSON
    pub id: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub level: ScheduleLevel,
    pub exclusive: bool,
    pub name: String,
    pub parents: Vec<String>,
    pub children: Vec<String>,
  }

  impl From<(ScheduleId, Schedule)> for ScheduleDto {
    fn from((id, s): (ScheduleId, Schedule)) -> Self {
      Self {
        id: id.to_string(),
        start: s.start(),
        end: s.end(),
        level: s.level(),
        exclusive: s.exclusive(),
        name: s.name().to_string(),
        parents: Vec::new(),
        children: Vec::new(),
      }
    }
  }

  #[tauri::command]
  pub fn create_schedule(payload: CreateSchedulePayload) -> Result<String, String> {
    let sched = Schedule::new(
      payload.start,
      payload.end,
      payload.level,
      payload.exclusive,
      payload.name,
    );
    // Convert parents from wire u128 -> runtime Uuid (ScheduleId)
    let mut parents: HashSet<ScheduleId> = HashSet::new();
    for p in payload.parents.into_iter() {
      match ScheduleId::parse_str(&p) {
        Ok(u) => {
          parents.insert(u);
        }
        Err(e) => return Err(format!("invalid parent uuid '{}': {}", p, e)),
      }
    }
    let mut mgr = MANAGER.write().map_err(|e| e.to_string())?;
    mgr
      .create_schedule(sched, parents)
      .map_err(|e| e.to_string())
      .map(|id| id.to_string())
  }

  #[tauri::command]
  pub fn delete_schedule(id: String) -> Result<(), String> {
    let mut mgr = MANAGER.write().map_err(|e| e.to_string())?;
    let uuid = ScheduleId::parse_str(&id).map_err(|e| e.to_string())?;
    mgr.delete_schedule(uuid).map_err(|e| e.to_string())
  }

  #[tauri::command]
  pub fn get_schedule(id: String) -> Option<ScheduleDto> {
    let mgr = MANAGER.read().ok()?;
    let uuid = ScheduleId::parse_str(&id).ok()?;
    mgr.get_schedule(uuid).map(|s| {
      let parents: Vec<String> = mgr
        .parent_relations()
        .get(&uuid)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|sid| sid.to_string())
        .collect();
      let children: Vec<String> = mgr
        .child_relations()
        .get(&uuid)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|sid| sid.to_string())
        .collect();
      ScheduleDto {
        id: uuid.to_string(),
        start: s.start(),
        end: s.end(),
        level: s.level(),
        exclusive: s.exclusive(),
        name: s.name().to_string(),
        parents,
        children,
      }
    })
  }

  #[tauri::command]
  pub fn query_schedules(opts: QueryOptions) -> Result<Vec<ScheduleDto>, String> {
    let mgr = MANAGER.read().map_err(|e| e.to_string())?;
    Ok(
      mgr
        .query_schedule(opts)
        .into_iter()
        .map(|(id, s)| {
          let parents: Vec<String> = mgr
            .parent_relations()
            .get(&id)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|sid| sid.to_string())
            .collect();
          let children: Vec<String> = mgr
            .child_relations()
            .get(&id)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|sid| sid.to_string())
            .collect();
          ScheduleDto {
            id: id.to_string(),
            start: s.start(),
            end: s.end(),
            level: s.level(),
            exclusive: s.exclusive(),
            name: s.name().to_string(),
            parents,
            children,
          }
        })
        .collect(),
    )
  }

  pub fn register(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![
      create_schedule,
      delete_schedule,
      get_schedule,
      query_schedules
    ])
  }
}

/// Manager that stores schedules and provides querying and validation with persistence.
///
/// This wraps the core ScheduleManager and adds persistent storage functionality.
#[derive(Serialize, Deserialize)]
pub struct ScheduleManager {
  /// Core in-memory schedule manager
  core_manager: CoreScheduleManager,
  /// Shared storage instance (opened at manager creation). `None` for in-memory only.
  #[serde(skip)]
  storage: Option<std::sync::Arc<crate::storage::Storage>>,
}

impl ScheduleManager {
  /// Create a new manager using default (in-memory) storage path.
  /// Equivalent to `Self::new_from_storage(None)`.
  pub fn new() -> Self {
    Self::new_from_storage(None)
  }

  /// Create a new manager and load persistent data from the given path.
  /// Pass `None` to use an in-memory DB.
  pub fn new_from_storage(path: Option<PathBuf>) -> Self {
    let storage = match path {
      Some(p) => {
        let db_path = Some(p.join("schedules.db"));
        match crate::storage::Storage::open_or_create(db_path) {
          Ok(s) => Some(std::sync::Arc::new(s)),
          Err(e) => {
            eprintln!("warning: failed to open storage: {e}");
            None
          }
        }
      }
      None => None,
    };

    let mut manager = Self {
      core_manager: CoreScheduleManager::new(),
      storage,
    };

    manager.load_from_storage();
    manager
  }

  /// Load schedules from persistent storage into the core manager.
  fn load_from_storage(&mut self) {
    if let Some(store) = &self.storage {
      if let Ok(items) = store.load_all() {
        // First pass: create schedules with preserved IDs but without parents.
        // This ensures schedules exist even if parents reference them later.
        for it in &items {
          let id: ScheduleId = it.id;
          let sched = Schedule::new(it.start, it.end, it.level, it.exclusive, it.name.clone());

          if let Err(e) = self
            .core_manager
            .create_schedule_with_id(id, sched, HashSet::new())
          {
            eprintln!(
              "Warning: Failed to create schedule with id {} from storage: {}",
              id, e
            );
          }
        }

        // Second pass: attach parent relations for each schedule.
        for it in items {
          let id: ScheduleId = it.id;
          let parents: HashSet<ScheduleId> = it.parents.into_iter().collect();
          if parents.is_empty() {
            continue;
          }

          if let Err(e) = self.core_manager.add_parents(id, parents) {
            eprintln!(
              "Warning: Failed to attach parents for schedule {}: {}",
              id, e
            );
          }
        }
      }
    }
  }

  /// Creates a new schedule and adds it to the manager with persistence.
  pub fn create_schedule(
    &mut self,
    schedule: Schedule,
    parents: HashSet<ScheduleId>,
  ) -> Result<ScheduleId, BackendScheduleError> {
    // Use core manager for validation and in-memory storage
    let schedule_id = self
      .core_manager
      .create_schedule(schedule.clone(), parents.clone())
      .map_err(BackendScheduleError::CoreError)?;

    // Persist to storage if available
    if let Some(store) = &self.storage {
      let item = PersistSchedule {
        key: schedule_id.as_bytes().to_vec(),
        id: schedule_id,
        start: schedule.start(),
        end: schedule.end(),
        level: schedule.level(),
        exclusive: schedule.exclusive(),
        name: schedule.name().to_string(),
        parents: parents.iter().copied().collect(),
        children: Vec::new(), // Children will be updated when relationships are established
      };
      if let Err(e) = store.upsert(item) {
        return Err(BackendScheduleError::StorageError(format!(
          "failed to persist: {e}"
        )));
      }
    }

    Ok(schedule_id)
  }

  /// Deletes a schedule from the manager and persistent storage.
  pub fn delete_schedule(&mut self, schedule_id: ScheduleId) -> Result<(), BackendScheduleError> {
    // Use core manager for in-memory deletion
    self
      .core_manager
      .delete_schedule(schedule_id)
      .map_err(BackendScheduleError::CoreError)?;

    // Remove from storage if available
    if let Some(store) = &self.storage {
      let item = PersistSchedule {
        key: schedule_id.as_bytes().to_vec(),
        id: schedule_id,
        start: DateTime::<Utc>::MIN_UTC,
        end: DateTime::<Utc>::MIN_UTC,
        level: 0,
        exclusive: false,
        name: String::new(),
        parents: Vec::new(),
        children: Vec::new(),
      };
      let _ = store.remove(item);
    }

    Ok(())
  }

  /// Gets a schedule by ID.
  pub fn get_schedule(&self, schedule_id: ScheduleId) -> Option<Schedule> {
    self.core_manager.get_schedule(schedule_id).cloned()
  }

  /// Query schedules using flexible options.
  pub fn query_schedule(&self, opts: QueryOptions) -> Vec<(ScheduleId, Schedule)> {
    self.core_manager.query_schedule(opts)
  }

  /// Get parent relations for a schedule.
  pub fn parent_relations(&self) -> &HashMap<ScheduleId, HashSet<ScheduleId>> {
    self.core_manager.parent_relations()
  }

  /// Get child relations for a schedule.
  pub fn child_relations(&self) -> &HashMap<ScheduleId, HashSet<ScheduleId>> {
    self.core_manager.child_relations()
  }
}
