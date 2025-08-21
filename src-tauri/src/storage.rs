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
    use super::*;

    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[native_model(id = 1, version = 1, with = native_model::bincode_1_3::Bincode)]
    #[native_db]
    pub struct ScheduleModel {
      #[primary_key]
      pub id: u128,
      pub start: chrono::DateTime<chrono::Utc>,
      pub end: chrono::DateTime<chrono::Utc>,
      pub level: u32,
      pub exclusive: bool,
      pub name: String,
      // Persist parent and child relationships as vectors of UUIDs
      pub parents: Vec<u128>,
      pub children: Vec<u128>,
    }
  }
}

static MODELS: Lazy<Models> = Lazy::new(|| {
  let mut m = Models::new();
  // register the model
  m.define::<data::v1::ScheduleModel>().unwrap();
  m
});

pub struct Storage<'a> {
  pub db: Database<'a>,
}

impl<'a> Storage<'a> {
  pub fn open_or_create(path: Option<PathBuf>) -> Result<Storage<'a>> {
    if let Some(p) = path {
      std::fs::create_dir_all(p.parent().unwrap_or(&std::path::PathBuf::from(".")))?;
      let db = Builder::new().create(&*MODELS, p)?;
      Ok(Storage { db })
    } else {
      let db = Builder::new().create_in_memory(&*MODELS)?;
      Ok(Storage { db })
    }
  }

  pub fn load_all(&'a self) -> Result<Vec<data::ScheduleModel>> {
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

  pub fn upsert(&'a self, item: data::ScheduleModel) -> Result<()> {
    let rw = self.db.rw_transaction()?;
    rw.upsert(item)?;
    rw.commit()?;
    Ok(())
  }

  pub fn remove(&'a self, item: data::ScheduleModel) -> Result<()> {
    let rw = self.db.rw_transaction()?;
    rw.remove(item)?;
    rw.commit()?;
    Ok(())
  }
}
