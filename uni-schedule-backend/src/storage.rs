use native_db::native_db;
use native_db::*;
use native_model::{native_model, Model};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub type Result<T> = std::result::Result<T, db_type::Error>;

// Define a storage model versioned via native_model.
pub mod data {
  use super::*;

  pub type ScheduleModel = v1::ScheduleModel;

  pub mod v1 {
    use crate::schedule::ScheduleId;

    use super::*;

    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[native_model(id = 1, version = 1, with = native_model::bincode_1_3::Bincode)]
    #[native_db]
    pub struct ScheduleModel {
      #[primary_key]
      pub key: Vec<u8>,
      pub id: ScheduleId,
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

static MODELS: Lazy<Models> = Lazy::new(|| {
  let mut m = Models::new();
  // register the model
  m.define::<data::v1::ScheduleModel>().unwrap();
  m
});

pub struct Storage {
  pub db: Database<'static>,
}

impl Storage {
  /// Open or create a storage instance. If `path` is Some, an on-disk DB is used;
  /// otherwise an in-memory DB is created.
  pub fn open_or_create(path: Option<PathBuf>) -> Result<Storage> {
    if let Some(p) = path {
      std::fs::create_dir_all(p.parent().unwrap_or(&std::path::PathBuf::from(".")))?;
      let db = Builder::new().create(&*MODELS, p)?;
      Ok(Storage { db })
    } else {
      let db = Builder::new().create_in_memory(&*MODELS)?;
      Ok(Storage { db })
    }
  }

  pub fn load_all(&self) -> Result<Vec<data::ScheduleModel>> {
    let r = self.db.r_transaction()?;
    let mut out: Vec<data::ScheduleModel> = Vec::new();
    let scan = r.scan();
    let primary = scan.primary::<data::ScheduleModel>()?;
    let results = primary.all()?;
    for item in results {
      out.push(item?);
    }
    Ok(out)
  }

  pub fn upsert(&self, item: data::ScheduleModel) -> Result<()> {
    let rw = self.db.rw_transaction()?;
    rw.upsert(item)?;
    rw.commit()?;
    Ok(())
  }

  pub fn remove(&self, item: data::ScheduleModel) -> Result<()> {
    let rw = self.db.rw_transaction()?;
    rw.remove(item)?;
    rw.commit()?;
    Ok(())
  }
}

/// Backend-local persistence abstraction kept inside the backend crate.
pub trait Persistence: Send + Sync {
  fn load_all(&self) -> Result<Vec<data::ScheduleModel>>;
  fn upsert(&self, item: data::ScheduleModel) -> Result<()>;
  fn remove(&self, item: data::ScheduleModel) -> Result<()>;
}

impl Persistence for Storage {
  fn load_all(&self) -> Result<Vec<data::ScheduleModel>> {
    // Call the inherent method to avoid recursive dispatch
    Storage::load_all(self)
  }

  fn upsert(&self, item: data::ScheduleModel) -> Result<()> {
    Storage::upsert(self, item)
  }

  fn remove(&self, item: data::ScheduleModel) -> Result<()> {
    Storage::remove(self, item)
  }
}
