use std::path::PathBuf;

use uni_schedule_core::schedule::ScheduleManager;

/// Persistence abstraction for the schedule manager.
///
/// Note: Methods are infallible by design to keep the trait simple; implementations
/// should handle errors internally (log or best-effort). Consumers can snapshot
/// the manager via serde and pass it to `save` without moving the live instance.
pub trait Storage {
  fn save(&mut self, manager: ScheduleManager);
  fn load(&self, manager: &mut ScheduleManager);
}

/// Sled-based persistent storage. The entire `ScheduleManager` is serialized
/// with bincode and stored under a single key.
pub struct SledStorage {
  db: sled::Db,
}

impl SledStorage {
  /// Open or create the storage at the provided base directory. When `base_dir`
  /// is None, a platform-specific local data directory is used.
  pub fn open(base_dir: Option<PathBuf>) -> Self {
    let base = base_dir
      .or_else(|| dirs::data_local_dir())
      .unwrap_or_else(|| std::env::current_dir().unwrap())
      .join("uni-schedule");
    let _ = std::fs::create_dir_all(&base);
    let path = base.join("db");
    let db = sled::open(path).expect("failed to open sled database");
    Self { db }
  }

  // /// Helper to persist a snapshot of a live manager by cloning via serde.
  // /// This avoids moving the actual manager, which is useful when the `Storage`
  // /// trait consumes the argument.
  // pub fn persist_snapshot(&mut self, manager_ref: &ScheduleManager) {
  //   match bincode::serialize(manager_ref) {
  //     Ok(bytes) => match bincode::deserialize::<ScheduleManager>(&bytes) {
  //       Ok(snapshot) => self.save(snapshot),
  //       Err(e) => eprintln!("storage: failed to clone manager for persist: {e}"),
  //     },
  //     Err(e) => eprintln!("storage: failed to serialize manager for persist: {e}"),
  //   }
  // }
}

impl Storage for SledStorage {
  fn save(&mut self, manager: ScheduleManager) {
    // match bincode::serialize(&manager) {
    //   Ok(bytes) => {
    //     if let Err(e) = self.db.insert("manager", bytes.as_slice()) {
    //       eprintln!("storage: failed to write to db: {e}");
    //     }
    //     if let Err(e) = self.db.flush() {
    //       eprintln!("storage: failed to flush db: {e}");
    //     }
    //   }
    //   Err(e) => eprintln!("storage: failed to serialize manager: {e}"),
    // }

    todo!("Implement SledStorage::save");
  }

  fn load(&self, manager: &mut ScheduleManager) {
    // match self.db.get("manager") {
    //   Ok(Some(ivec)) => match bincode::deserialize::<ScheduleManager>(&ivec) {
    //     Ok(loaded) => {
    //       *manager = loaded;
    //     }
    //     Err(e) => eprintln!("storage: failed to deserialize manager: {e}"),
    //   },
    //   Ok(None) => {
    //     // No prior state; keep the provided default instance
    //   }
    //   Err(e) => eprintln!("storage: failed to read from db: {e}"),
    // }

    todo!("Implement SledStorage::load");
  }
}

/// Simple in-memory storage useful for tests and ephemeral runs.
///
/// Stores the manager inside a `RefCell<Option<ScheduleManager>>`. The
/// `save` method replaces the stored value. The `load` method clones the
/// stored manager by serializing with `bincode` and deserializing a fresh
/// instance so `ScheduleManager` is not required to implement `Clone`.
pub struct MockStorage {
  stored: Option<ScheduleManager>,
}

impl MockStorage {
  /// Create an empty in-memory storage.
  pub fn new() -> Self {
    Self { stored: None }
  }
}

impl Storage for MockStorage {
  fn save(&mut self, manager: ScheduleManager) {
    self.stored = Some(manager);
  }

  fn load(&self, manager: &mut ScheduleManager) {
    if let Some(stored) = &self.stored {
      manager.clone_from(&stored);
    }
  }
}
