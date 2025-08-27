use bincode;
use serde::{Deserialize, Serialize};
use sled::Db;
use std::fmt;
use std::io;
use std::path::PathBuf;

/// Storage-specific error enum covering sled, bincode and IO errors.
#[derive(Debug)]
pub enum StorageError {
  Sled(sled::Error),
  Bincode(bincode::Error),
  Io(io::Error),
  Other(String),
}

impl fmt::Display for StorageError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      StorageError::Sled(e) => write!(f, "sled error: {}", e),
      StorageError::Bincode(e) => write!(f, "bincode error: {}", e),
      StorageError::Io(e) => write!(f, "io error: {}", e),
      StorageError::Other(s) => write!(f, "{}", s),
    }
  }
}

impl std::error::Error for StorageError {
  fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
    match self {
      StorageError::Sled(e) => Some(e),
      StorageError::Bincode(e) => Some(e),
      StorageError::Io(e) => Some(e),
      StorageError::Other(_) => None,
    }
  }
}

impl From<sled::Error> for StorageError {
  fn from(e: sled::Error) -> Self {
    StorageError::Sled(e)
  }
}

impl From<bincode::Error> for StorageError {
  fn from(e: bincode::Error) -> Self {
    StorageError::Bincode(e)
  }
}

impl From<io::Error> for StorageError {
  fn from(e: io::Error) -> Self {
    StorageError::Io(e)
  }
}

pub type Result<T> = std::result::Result<T, StorageError>;

// Define a storage model versioned via native_model-compatible attributes where useful.
pub mod data {
  use super::*;

  pub type ScheduleModel = v1::ScheduleModel;

  pub mod v1 {
    use crate::schedule::ScheduleId;

    use super::*;

    #[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
    pub struct ScheduleModel {
      pub start: chrono::DateTime<chrono::Utc>,
      pub end: chrono::DateTime<chrono::Utc>,
      pub level: u32,
      pub exclusive: bool,
      pub name: String,
      // Persist parent and child relationships as vectors of UUIDs
      pub parents: Vec<ScheduleId>,
      pub children: Vec<ScheduleId>,
    }
  }
}

pub struct Storage {
  pub db: Db,
}

// StoredSchedule removed: tests and mock storage now use (ScheduleId, ScheduleModel) tuples.

impl Storage {
  /// Open or create a storage instance. If `path` is Some, an on-disk DB is used;
  /// otherwise an in-memory temporary DB is created.
  pub fn open_or_create(path: Option<PathBuf>) -> Result<Storage> {
    let db = if let Some(p) = path {
      if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
      }
      sled::Config::default().path(p).open()?
    } else {
      // temporary in-memory DB
      sled::Config::default().temporary(true).open()?
    };

    Ok(Storage { db })
  }

  /// Return all stored schedules as a vector of (ScheduleId, model).
  pub fn load_all(&self) -> Result<Vec<(crate::schedule::ScheduleId, data::ScheduleModel)>> {
    let mut out: Vec<(crate::schedule::ScheduleId, data::ScheduleModel)> = Vec::new();
    let iter = self.db.iter();
    for item in iter {
      let (k, v) = item?;
      let model: data::ScheduleModel = bincode::deserialize(&v)?;
      // attempt to parse the key back into a ScheduleId (uuid)
      let id = match crate::schedule::ScheduleId::from_slice(&k) {
        Ok(u) => u,
        Err(_) => crate::schedule::ScheduleId::nil(),
      };
      out.push((id, model));
    }
    Ok(out)
  }

  /// Upsert a model under the given id. The key is derived from `id.as_bytes()`.
  pub fn upsert(&self, id: crate::schedule::ScheduleId, item: data::ScheduleModel) -> Result<()> {
    let key = id.as_bytes().to_vec();
    let val = bincode::serialize(&item)?;
    self.db.insert(key, val)?;
    // sled is crash-safe, but flush to ensure durability on commit
    self.db.flush()?;
    Ok(())
  }

  /// Remove by id.
  pub fn remove(&self, id: crate::schedule::ScheduleId) -> Result<()> {
    self.db.remove(id.as_bytes().to_vec())?;
    self.db.flush()?;
    Ok(())
  }
}

/// Backend-local persistence abstraction kept inside the backend crate.
pub trait Persistence: Send + Sync {
  /// Construct an instance of this persistence implementation.
  /// Implementations should ignore the path if they don't support on-disk storage
  /// (for example, MockStorage will return an in-memory mock regardless).
  fn create(path: Option<PathBuf>) -> Result<Box<dyn Persistence>>
  where
    Self: Sized;

  fn load_all(&self) -> Result<Vec<(crate::schedule::ScheduleId, data::ScheduleModel)>>;
  fn upsert(&self, id: crate::schedule::ScheduleId, item: data::ScheduleModel) -> Result<()>;
  fn remove(&self, id: crate::schedule::ScheduleId) -> Result<()>;
}

impl Persistence for Storage {
  fn create(path: Option<PathBuf>) -> Result<Box<dyn Persistence>> {
    let s = Storage::open_or_create(path)?;
    Ok(Box::new(s))
  }
  fn load_all(&self) -> Result<Vec<(crate::schedule::ScheduleId, data::ScheduleModel)>> {
    Storage::load_all(self)
  }

  fn upsert(&self, id: crate::schedule::ScheduleId, item: data::ScheduleModel) -> Result<()> {
    Storage::upsert(self, id, item)
  }

  fn remove(&self, id: crate::schedule::ScheduleId) -> Result<()> {
    Storage::remove(self, id)
  }
}

#[cfg(test)]
mod mock_storage {
  use super::*;
  use std::sync::{Arc, Mutex};

  // A simple in-memory mock storage used for unit tests.
  // This type is thread-safe (Arc<Mutex<...>>) so it satisfies `Send + Sync`.
  #[derive(Clone, Debug)]
  pub struct MockStorage {
    inner: Arc<Mutex<Vec<(crate::schedule::ScheduleId, data::ScheduleModel)>>>,
  }

  impl MockStorage {
    pub fn new() -> Self {
      MockStorage {
        inner: Arc::new(Mutex::new(Vec::new())),
      }
    }

    pub fn with_items(items: Vec<(crate::schedule::ScheduleId, data::ScheduleModel)>) -> Self {
      MockStorage {
        inner: Arc::new(Mutex::new(items)),
      }
    }

    /// Returns a clone of the inner Arc so tests can inspect/mutate directly if needed.
    pub fn inner(&self) -> Arc<Mutex<Vec<(crate::schedule::ScheduleId, data::ScheduleModel)>>> {
      self.inner.clone()
    }
  }

  impl Persistence for MockStorage {
    fn create(path: Option<PathBuf>) -> Result<Box<dyn Persistence>> {
      let m = MockStorage::new();
      Ok(Box::new(m))
    }
    fn load_all(&self) -> Result<Vec<(crate::schedule::ScheduleId, data::ScheduleModel)>> {
      let guard = self.inner.lock().unwrap();
      Ok(guard.clone())
    }

    fn upsert(&self, id: crate::schedule::ScheduleId, item: data::ScheduleModel) -> Result<()> {
      let mut guard = self.inner.lock().unwrap();
      if let Some(pos) = guard.iter().position(|(iid, _)| *iid == id) {
        guard[pos] = (id, item);
      } else {
        guard.push((id, item));
      }
      Ok(())
    }

    fn remove(&self, id: crate::schedule::ScheduleId) -> Result<()> {
      let mut guard = self.inner.lock().unwrap();
      guard.retain(|(iid, _)| *iid != id);
      Ok(())
    }
  }
}

#[cfg(test)]
mod tests {
  use super::mock_storage::MockStorage;
  use super::*;
  use chrono::Utc;

  fn make_model(
    id: crate::schedule::ScheduleId,
    name: &str,
  ) -> (crate::schedule::ScheduleId, data::ScheduleModel) {
    let model = data::ScheduleModel {
      start: Utc::now(),
      end: Utc::now(),
      level: 0,
      exclusive: false,
      name: name.to_string(),
      parents: Vec::new(),
      children: Vec::new(),
    };
    (id, model)
  }

  #[test]
  fn mockstorage_upsert_load_remove() {
    let store = MockStorage::new();
    let id = crate::schedule::ScheduleId::nil();
    let (id, m) = make_model(id, "a");

    // upsert
    store.upsert(id, m.clone()).unwrap();
    let all = store.load_all().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].1.name, "a");

    // update
    let mut updated = m.clone();
    updated.name = "b".to_string();
    store.upsert(id, updated.clone()).unwrap();
    let all = store.load_all().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].1.name, "b");

    // remove
    store.remove(id).unwrap();
    let all = store.load_all().unwrap();
    assert!(all.is_empty());
  }
}
