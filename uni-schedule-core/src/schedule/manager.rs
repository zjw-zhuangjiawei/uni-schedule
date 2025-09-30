use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
  collections::{BTreeMap, HashMap, HashSet},
  path::PathBuf,
  sync::Arc,
};
use thiserror::Error;
use typed_builder::TypedBuilder;
use uuid::Uuid;

use super::{ScheduleId, lapper::Lapper};

/// Errors returned by schedule operations.
///
/// These variants are used by `ScheduleManager` methods to indicate
/// validation failures (for example invalid time ranges or hierarchy
/// violations), lookup failures (missing parent or schedule), or
/// conflicts (overlapping time ranges).
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ScheduleError {
  /// The schedule's start time is after its end time.
  #[error("Start time is later than end time")]
  StartAfterEnd,

  /// The schedule's level is not lower than its parent schedule's level.
  /// Parents must have a strictly lower numeric level than their children.
  #[error("Schedule level is too high compared to parent")]
  LevelExceedsParent,

  /// The schedule's time range is not fully contained within the
  /// parent's time range.
  #[error("Time range exceeds parent schedule")]
  TimeRangeExceedsParent,

  /// A referenced parent schedule ID does not exist in the manager.
  #[error("Parent not found")]
  ParentNotFound,

  /// The schedule's time range would overlap with an existing
  /// schedule in a way that violates exclusivity or level constraints.
  #[error("Time range overlaps with existing schedule")]
  TimeRangeOverlaps,

  /// The requested schedule ID was not found.
  #[error("Schedule not found")]
  ScheduleNotFound,
  /// ID generation failed after multiple attempts (extremely unlikely)
  #[error("Duplicate schedule id generation failure")]
  DuplicateId,
}

pub type ScheduleLevel = u32;

/// Options to query schedules. Designed to be extensible: a custom matcher
/// can be provided via `matcher` for future fields/complex filters.
///
/// # Examples
///
/// Using the builder pattern:
/// ```rust,ignore
/// let opts = QueryOptions::builder()
///     .name("task".to_string())
///     .level(1)
///     .exclusive(true)
///     .build();
/// ```
///
/// Or with default values:
/// ```rust,ignore
/// let opts = QueryOptions::builder()
///     .name("task".to_string())
///     .build();
/// ```
#[derive(Serialize, Deserialize, Clone, TypedBuilder)]
#[builder(field_defaults(default))]
pub struct QueryOptions {
  #[builder(default, setter(into, strip_option))]
  pub name: Option<String>,
  #[builder(default, setter(into, strip_option))]
  pub start: Option<DateTime<Utc>>,
  #[builder(default, setter(into, strip_option))]
  pub stop: Option<DateTime<Utc>>,
  #[builder(default, setter(into, strip_option))]
  pub level: Option<ScheduleLevel>,
  #[builder(default, setter(into, strip_option))]
  pub exclusive: Option<bool>,
  /// Optional custom matcher that receives a schedule and returns true when
  /// the schedule should be included. Use this to extend filtering without
  /// changing the struct.
  #[serde(skip_serializing, skip_deserializing)]
  pub matcher: Option<Arc<dyn Fn(&Schedule) -> bool + Send + Sync>>,
}

impl Default for QueryOptions {
  fn default() -> Self {
    Self {
      name: None,
      start: None,
      stop: None,
      level: None,
      exclusive: None,
      matcher: None,
    }
  }
}

/// A single schedule entry.
///
/// `Schedule` represents a time-bounded item with a hierarchical level and
/// an exclusivity flag. Instances are stored in `ScheduleManager` and
/// referenced by `ScheduleId` (a `Uuid`). The struct is serializable so it
/// can be persisted or sent over IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schedule {
  // id: ScheduleId,
  /// Inclusive start time of the schedule (half-open semantics are used by
  /// indexing helpers: ranges are treated as `[start, end)`).
  pub start: DateTime<Utc>,
  /// Exclusive end time of the schedule interval.
  pub end: DateTime<Utc>,
  /// Numeric hierarchy level of the schedule. Lower numbers indicate
  /// higher-level (parent) schedules.
  pub level: ScheduleLevel,
  /// When true indicates this schedule must not be overlapped by other
  /// schedules at the same or lower levels (enforced by the manager).
  pub exclusive: bool,
  /// Human-readable name for the schedule.
  pub name: String,
}

impl Schedule {
  pub fn new(
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    level: ScheduleLevel,
    exclusive: bool,
    name: String,
  ) -> Self {
    Self {
      start,
      end,
      level,
      exclusive,
      name,
    }
  }

  #[allow(dead_code)]
  pub fn start(&self) -> DateTime<Utc> {
    self.start
  }
  #[allow(dead_code)]
  pub fn end(&self) -> DateTime<Utc> {
    self.end
  }
  #[allow(dead_code)]
  pub fn level(&self) -> ScheduleLevel {
    self.level
  }
  #[allow(dead_code)]
  pub fn exclusive(&self) -> bool {
    self.exclusive
  }
  #[allow(dead_code)]
  pub fn name(&self) -> &str {
    &self.name
  }
}

/// Manager that stores schedules and provides querying and validation.
///
/// `ScheduleManager` is the primary API for creating, deleting and
/// querying schedules. It keeps:
/// - a `schedules` map keyed by `ScheduleId` containing actual schedule data,
/// - `exclusive_index` and `all_index` BTreeMaps that map `ScheduleLevel` to
///   a `Lapper` interval index for fast overlap and coverage checks,
/// - `parent_relations` and `child_relations` maps that describe the
///   hierarchical relationships between schedules.
///
/// Common operations:
/// - `create_schedule` validates a schedule against parents, existing
///   intervals and exclusivity rules, inserts it into the indices and
///   records parent/child relations.
/// - `delete_schedule` removes a schedule from indices and relation maps.
/// - `query_schedule` filters schedules using flexible `QueryOptions`.
///
/// The manager is intended to be used from a single thread; if shared
/// across threads, callers should wrap it in appropriate synchronization
/// primitives (e.g., `RwLock`).
#[derive(Clone)]
pub struct ScheduleManager {
  /// Stored schedules by their `ScheduleId`.
  schedules: HashMap<ScheduleId, Schedule>,
  /// Interval indices for schedules marked exclusive (per level).
  exclusive_index: BTreeMap<ScheduleLevel, Lapper>,
  /// Interval indices for all schedules (per level).
  all_index: BTreeMap<ScheduleLevel, Lapper>,
  /// For each schedule, the set of its parents.
  parent_relations: HashMap<ScheduleId, HashSet<ScheduleId>>,
  /// For each schedule, the set of its children.
  child_relations: HashMap<ScheduleId, HashSet<ScheduleId>>,

  /// Index mapping level -> set of schedule ids at that level. Used to
  /// quickly narrow queries by level.
  level_index: HashMap<ScheduleLevel, HashSet<ScheduleId>>,
  // Full-text search functionality disabled
  // // Tantivy full-text index for `name` field (in-memory directory).
  // #[serde(skip)]
  // fulltext_index: Option<Index>,
  // ft_id_field: Option<Field>,
  // ft_name_field: Option<Field>,
  // /// Reusable writer for incremental indexing (not serialized)
  // #[serde(skip)]
  // ft_writer: Option<IndexWriter>,
  // #[serde(skip)]
  // ft_pending_ops: usize,
}

impl ScheduleManager {
  /// Create a new manager using default (in-memory) storage path.
  /// Equivalent to `Self::new_from_storage(None)`.
  pub fn new() -> Self {
    // Reverted: default to in-memory (no persistence) unless explicitly requested.
    Self::new_from_storage(None)
  }

  /// Generate a unique schedule ID with proper error handling
  fn generate_unique_id(&self) -> Result<ScheduleId, ScheduleError> {
    const MAX_ID_ATTEMPTS: usize = 16;
    for _ in 0..MAX_ID_ATTEMPTS {
      let candidate = Uuid::now_v7();
      if !self.schedules.contains_key(&candidate) {
        return Ok(candidate);
      }
    }
    Err(ScheduleError::DuplicateId)
  }

  /// Validate schedule constraints against parents and time ranges
  fn validate_schedule(
    &self,
    schedule: &Schedule,
    parents: &HashSet<ScheduleId>,
  ) -> Result<(), ScheduleError> {
    // Validate schedule time range: require start < end (disallow zero-length)
    if schedule.start >= schedule.end {
      return Err(ScheduleError::StartAfterEnd);
    }

    // Validate parent relationships
    for parent_id in parents {
      match self.schedules.get(parent_id) {
        Some(parent) => {
          if parent.level >= schedule.level {
            return Err(ScheduleError::LevelExceedsParent);
          }
          if parent.start > schedule.start || parent.end < schedule.end {
            return Err(ScheduleError::TimeRangeExceedsParent);
          }
        }
        None => return Err(ScheduleError::ParentNotFound),
      }
    }

    // Check for overlaps with exclusive schedules at parent or same level.
    // Note: lower numeric values indicate higher-level (parent) schedules,
    // so we iterate existing exclusive index keys with numeric value <=
    // `schedule.level`. This prevents same-level exclusive peers from
    // overlapping a non-exclusive schedule.
    for (&level, lapper) in self.exclusive_index.range(..=schedule.level).rev() {
      // Check for overlaps, but ignore intervals that correspond to
      // the explicit `parents` set — a child is allowed to be contained
      // within its parent even if the parent is exclusive.
      for iv in lapper.find(schedule.start, schedule.end) {
        if !parents.contains(&iv.val) {
          return Err(ScheduleError::TimeRangeOverlaps);
        }
      }
    }

    // If this schedule is exclusive, check for overlaps with any schedules at same or lower levels
    if schedule.exclusive {
      for (_, lapper) in self.all_index.range(schedule.level..) {
        for iv in lapper.find(schedule.start, schedule.end) {
          if !parents.contains(&iv.val) {
            return Err(ScheduleError::TimeRangeOverlaps);
          }
        }
      }
    }

    Ok(())
  }

  /// Execute the schedule creation transaction atomically
  fn execute_create_transaction(
    &mut self,
    schedule_id: ScheduleId,
    schedule: Schedule,
    parents: HashSet<ScheduleId>,
  ) -> Result<(), ScheduleError> {
    // Insert into exclusive index if needed
    if schedule.exclusive {
      let lapper = self
        .exclusive_index
        .entry(schedule.level)
        .or_insert_with(|| Lapper::new(std::collections::BTreeSet::new()));

      lapper.insert(super::lapper::Interval {
        start: schedule.start,
        stop: schedule.end,
        val: schedule_id,
      });
    }

    // Insert into all index
    let lapper = self
      .all_index
      .entry(schedule.level)
      .or_insert_with(|| Lapper::new(std::collections::BTreeSet::new()));

    lapper.insert(super::lapper::Interval {
      start: schedule.start,
      stop: schedule.end,
      val: schedule_id,
    });

    // Update parent-child relationships
    for parent in &parents {
      self
        .child_relations
        .entry(*parent)
        .or_default()
        .insert(schedule_id);
    }
    self.parent_relations.insert(schedule_id, parents);

    // Insert into schedule storage (in-memory map)
    self.schedules.insert(schedule_id, schedule.clone());

    // Update level index
    self
      .level_index
      .entry(schedule.level)
      .or_default()
      .insert(schedule_id);

    // Storage integration removed from uni-schedule-core (no persistent store here).

    // Update full-text index - disabled
    // self.ft_add_schedule(schedule_id, &schedule);
    // self.ft_maybe_commit(true);

    Ok(())
  }

  // Full-text search functionality disabled
  /*
  /// Build a tantivy index. If `path` is `Some`, attempt to open or create
  /// a disk-backed index under `path.join("tantivy")`. If `None` an
  /// in-memory index is returned.
  fn build_tantivy_index(path: Option<&PathBuf>) -> Option<(Index, Field, Field)> {
    let mut s = Schema::builder();
    let id_field = s.add_text_field("id", STRING | STORED);
    let name_field = s.add_text_field("name", TEXT | STORED);
    let schema = s.build();

    if let Some(base) = path {
      let dir = base.join("tantivy");
      if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("warning: failed to create tantivy dir {dir:?}: {e}");
        return None;
      }

      // Try to open an existing index on disk, otherwise create it.
      match Index::open_in_dir(&dir) {
        Ok(idx) => return Some((idx, id_field, name_field)),
        Err(_) => match Index::create_in_dir(&dir, schema.clone()) {
          Ok(idx) => return Some((idx, id_field, name_field)),
          Err(e) => {
            eprintln!("warning: failed to create tantivy index on disk: {e}");
            // Fallback to in-memory index to keep functionality.
            let idx = Index::create_in_ram(schema);
            return Some((idx, id_field, name_field));
          }
        },
      }
    }

    let idx = Index::create_in_ram(schema);
    Some((idx, id_field, name_field))
  }
  */

  // construct a manager without loading persistent storage
  fn new_base(_storage_path: Option<PathBuf>) -> Self {
    // Full-text search functionality disabled
    /*
    let (tantivy_index, id_field, name_field) =
      match Self::build_tantivy_index(storage_path.as_ref()) {
        Some((idx, ft_id_field, ft_name_field)) => {
          (Some(idx), Some(ft_id_field), Some(ft_name_field))
        }
        None => (None, None, None),
      };
    */
    Self {
      schedules: HashMap::new(),
      exclusive_index: BTreeMap::new(),
      all_index: BTreeMap::new(),
      parent_relations: HashMap::new(),
      child_relations: HashMap::new(),
      level_index: HashMap::new(),
      // Full-text search fields commented out
      // fulltext_index: tantivy_index,
      // ft_id_field: id_field,
      // ft_name_field: name_field,
      // ft_writer: None,
      // ft_pending_ops: 0,
    }
  }

  /// Create a new manager and (previously) load persistent data from the given path.
  /// Pass `None` to use an in-memory DB.
  pub fn new_from_storage(path: Option<PathBuf>) -> Self {
    let mgr = Self::new_base(path.clone());
    // Storage integration removed from uni-schedule-core: do not attempt to load persistent data.
    // mgr.load_from_storage(path);
    // mgr.init_fulltext_writer();  // Disabled - full-text search functionality removed
    mgr
  }

  // Full-text search functionality disabled
  /*
  /// Bulk rebuild tantivy name index after loading storage.
  fn rebuild_name_index(&self) {
    if let (Some(idx), Some(id_field), Some(name_field)) =
      (&self.fulltext_index, self.ft_id_field, self.ft_name_field)
    {
      if let Ok(mut w) = idx.writer(10_000_000) {
        let _ = w.delete_all_documents();
        for (id, sched) in &self.schedules {
          let d = doc!(id_field => id.to_string(), name_field => sched.name.clone());
          let _ = w.add_document(d);
        }
        let _ = w.commit();
      }
    }
  }

  /// Initialize/recreate the reusable full-text writer (called after load or rebuild).
  fn init_fulltext_writer(&mut self) {
    if let Some(idx) = &self.fulltext_index {
      self.ft_writer = idx.writer(10_000_000).ok();
      self.ft_pending_ops = 0;
    }
  }
  */

  // Full-text search functionality disabled
  /*
  /// Flush pending writer operations if threshold reached or on demand.
  fn ft_maybe_commit(&mut self, force: bool) {
    const FT_COMMIT_THRESHOLD: usize = 32; // tune as needed
    if let Some(writer) = &mut self.ft_writer {
      if force || self.ft_pending_ops >= FT_COMMIT_THRESHOLD {
        let _ = writer.commit();
        self.ft_pending_ops = 0;
      }
    }
  }

  /// Add (or replace) a schedule doc in the full-text index incrementally.
  fn ft_add_schedule(&mut self, id: ScheduleId, sched: &Schedule) {
    if let (Some(writer), Some(id_field), Some(name_field)) = (
      self.ft_writer.as_mut(),
      self.ft_id_field,
      self.ft_name_field,
    ) {
      let term = Term::from_field_text(id_field, &id.to_string());
      writer.delete_term(term);
      let d = doc!(id_field => id.to_string(), name_field => sched.name.clone());
      if writer.add_document(d).is_ok() {
        self.ft_pending_ops += 1;
        self.ft_maybe_commit(false);
      }
    }
  }

  /// Delete a schedule doc from the full-text index incrementally.
  fn ft_delete_schedule(&mut self, id: ScheduleId) {
    if let (Some(writer), Some(id_field)) = (self.ft_writer.as_mut(), self.ft_id_field) {
      let term = Term::from_field_text(id_field, &id.to_string());
      writer.delete_term(term);
      self.ft_pending_ops += 1;
      self.ft_maybe_commit(false);
    }
  }
  */

  /// Creates a new schedule and adds it to the manager.
  ///
  /// # Arguments
  /// * `schedule` - The schedule to be created, containing its time range, level, and exclusivity.
  /// * `parents` - A set of parent schedule IDs to which this schedule will be related.
  ///
  /// # Returns
  /// Returns the unique ID of the newly created schedule on success, or a `ScheduleError` if validation fails.
  ///
  /// # Errors
  /// Returns:
  /// - `StartAfterEnd` if the schedule's start time is after its end time.
  /// - `LevelExceedsParent` if the schedule's level is not lower than its parent.
  /// - `TimeRangeExceedsParent` if the schedule's time range is not within its parent's time range.
  /// - `ParentNotFound` if any parent ID does not exist.
  /// - `TimeRangeOverlaps` if the schedule's time range overlaps with an existing exclusive or all-level schedule.
  pub fn create_schedule(
    &mut self,
    schedule: Schedule,
    parents: HashSet<ScheduleId>,
  ) -> Result<ScheduleId, ScheduleError> {
    // Validate the schedule and its constraints
    self.validate_schedule(&schedule, &parents)?;

    // Generate a unique ID
    let schedule_id = self.generate_unique_id()?;

    // Execute the creation transaction
    self.execute_create_transaction(schedule_id, schedule, parents)?;

    Ok(schedule_id)
  }

  /// Create a schedule using an explicit, caller-provided ID.
  ///
  /// This preserves IDs when loading from an external store. The provided
  /// `schedule_id` must not already exist in the manager. Validation is run
  /// against the supplied `parents` (so parents must already be present).
  pub fn create_schedule_with_id(
    &mut self,
    schedule_id: ScheduleId,
    schedule: Schedule,
    parents: HashSet<ScheduleId>,
  ) -> Result<ScheduleId, ScheduleError> {
    // ensure id is not already present
    if self.schedules.contains_key(&schedule_id) {
      return Err(ScheduleError::DuplicateId);
    }

    // Validate against parents (parents must exist)
    self.validate_schedule(&schedule, &parents)?;

    // Execute creation using the provided id
    self.execute_create_transaction(schedule_id, schedule, parents)?;
    Ok(schedule_id)
  }

  /// Attach parent relationships to an existing schedule.
  ///
  /// Validates the constraints of the schedule against the provided parents
  /// and updates parent/child relation maps. Parents must already exist.
  pub fn add_parents(
    &mut self,
    schedule_id: ScheduleId,
    parents: HashSet<ScheduleId>,
  ) -> Result<(), ScheduleError> {
    // Ensure schedule exists
    let schedule = self
      .schedules
      .get(&schedule_id)
      .ok_or(ScheduleError::ScheduleNotFound)?
      .clone();

    // Validate constraints against the parents
    self.validate_schedule(&schedule, &parents)?;

    // Update child relations and parent_relations map
    for parent in &parents {
      self
        .child_relations
        .entry(*parent)
        .or_default()
        .insert(schedule_id);
    }
    // Merge with any existing parents for this schedule
    self
      .parent_relations
      .entry(schedule_id)
      .and_modify(|p| p.extend(parents.iter().copied()))
      .or_insert(parents);

    Ok(())
  }
  pub fn delete_schedule(
    &mut self,
    schedule_id: ScheduleId,
  ) -> Result<std::collections::HashSet<ScheduleId>, ScheduleError> {
    // Get the schedule first to validate it exists
    let schedule = self
      .schedules
      .get(&schedule_id)
      .ok_or(ScheduleError::ScheduleNotFound)?
      .clone();

    // Remove from indices
    if schedule.exclusive {
      debug_assert!(
        self.exclusive_index.contains_key(&schedule.level),
        "internal invariant: missing exclusive index for schedule level"
      );
      // The debug_assert above guarantees the key exists in the map.
      // Access it safely and panic with a clear message if the invariant
      // is violated in release builds.
      let lapper = self
        .exclusive_index
        .get_mut(&schedule.level)
        .expect("internal invariant: missing exclusive index for schedule level");

      lapper.remove(&super::lapper::Interval {
        start: schedule.start,
        stop: schedule.end,
        val: schedule_id,
      });
    }

    debug_assert!(
      self.all_index.contains_key(&schedule.level),
      "internal invariant: missing all index for schedule level"
    );
    // The debug_assert above guarantees the key exists in the map.
    // Access it safely and panic with a clear message if the invariant
    // is violated in release builds.
    let lapper = self
      .all_index
      .get_mut(&schedule.level)
      .expect("internal invariant: missing all index for schedule level");

    lapper.remove(&super::lapper::Interval {
      start: schedule.start,
      stop: schedule.end,
      val: schedule_id,
    });

    // Aggregate set of removed ids including this schedule and any
    // recursively deleted children. We remove `schedule_id`'s child
    // entry first then walk children, delegating deletion to the
    // recursive call which itself returns the set of ids it removed.
    let mut removed: std::collections::HashSet<ScheduleId> = std::collections::HashSet::new();
    if let Some(children) = self.child_relations.remove(&schedule_id) {
      for child in children {
        // Remove this schedule from the child's parent set
        if let Some(parents) = self.parent_relations.get_mut(&child) {
          parents.remove(&schedule_id);
          // If child has no remaining parents, cascade delete it
          if parents.is_empty() {
            let child_removed = self.delete_schedule(child)?;
            removed.extend(child_removed.into_iter());
          }
        }
      }
    }

    // Remove parent relations
    self.parent_relations.remove(&schedule_id);

    // Remove from level index
    if let Some(set) = self.level_index.get_mut(&schedule.level) {
      set.remove(&schedule_id);
      if set.is_empty() {
        self.level_index.remove(&schedule.level);
      }
    }

    // Remove from schedules map (in-memory)
    self.schedules.remove(&schedule_id);

    // include this id in the returned set
    removed.insert(schedule_id);

    // Update full-text index - disabled
    // self.ft_delete_schedule(schedule_id);

    // Storage integration removed from uni-schedule-core: no persistent removal here.

    Ok(removed)
  }

  pub fn get_schedule(&self, schedule_id: ScheduleId) -> Option<&Schedule> {
    self.schedules.get(&schedule_id)
  }

  /// Query schedules using flexible options.
  ///
  /// Returns a Vec of (ScheduleId, Schedule) matching the filters. The returned
  /// schedules are clones of the stored schedules so the caller can freely use
  /// or modify them.
  pub fn query_schedule(&self, opts: QueryOptions) -> Vec<(ScheduleId, Schedule)> {
    let mut out = Vec::new();

    // Determine candidate set using available indexes to avoid scanning
    // all schedules when possible.
    let mut candidates: Option<HashSet<ScheduleId>> = None;

    // If level is specified, start from the level index
    if let Some(level) = opts.level {
      if let Some(set) = self.level_index.get(&level) {
        candidates = Some(set.clone());
      } else {
        // no schedules at this level
        return out;
      }
    }

    // Full-text search (tantivy) candidate narrowing temporarily disabled; name filtering is applied later linearly.

    // If exclusive filter is specified, intersect with computed exclusive set
    if let Some(excl) = opts.exclusive {
      if excl {
        // Compute exclusive IDs on demand from exclusive indices
        let mut excl_ids = HashSet::new();
        for lapper in self.exclusive_index.values() {
          for interval in &lapper.intervals {
            excl_ids.insert(interval.val);
          }
        }
        match &mut candidates {
          Some(c) => {
            *c = c.intersection(&excl_ids).cloned().collect();
          }
          None => {
            candidates = Some(excl_ids);
          }
        }
      } else {
        // excl == false: prefer candidates that are NOT exclusive
        // Compute exclusive IDs on demand
        let mut excl_ids = HashSet::new();
        for lapper in self.exclusive_index.values() {
          for interval in &lapper.intervals {
            excl_ids.insert(interval.val);
          }
        }
        match &mut candidates {
          Some(c) => {
            for id in excl_ids.iter() {
              c.remove(id);
            }
          }
          None => {
            // build candidate set as all schedules minus exclusive ones
            let mut s = HashSet::new();
            for id in self.schedules.keys() {
              if !excl_ids.contains(id) {
                s.insert(*id);
              }
            }
            candidates = Some(s);
          }
        }
      }
    }

    // If still no candidates chosen, use all schedule ids as baseline
    let base_ids: HashSet<ScheduleId> = match candidates {
      Some(c) => c,
      None => self.schedules.keys().cloned().collect(),
    };

    // Now apply remaining filters (name, time, matcher) on candidate ids
    for id in base_ids {
      if let Some(schedule) = self.schedules.get(&id) {
        if let Some(ref name_filter) = opts.name {
          if !schedule.name.contains(name_filter) {
            continue;
          }
        }

        // Time filtering:
        match (opts.start, opts.stop) {
          (Some(s), Some(e)) => {
            // include schedules that overlap the provided range
            if !(schedule.start < e && schedule.end > s) {
              continue;
            }
          }
          (Some(s), None) => {
            // include schedules that end after the given start
            if schedule.end <= s {
              continue;
            }
          }
          (None, Some(e)) => {
            // include schedules that start before the given stop
            if schedule.start >= e {
              continue;
            }
          }
          (None, None) => {}
        }

        if let Some(ref m) = opts.matcher {
          if !(m(schedule)) {
            continue;
          }
        }

        out.push((id, schedule.clone()));
      }
    }

    out
  }

  /// Get a reference to the parent relations map.
  pub fn parent_relations(&self) -> &HashMap<ScheduleId, HashSet<ScheduleId>> {
    &self.parent_relations
  }

  /// Get a reference to the child relations map.
  pub fn child_relations(&self) -> &HashMap<ScheduleId, HashSet<ScheduleId>> {
    &self.child_relations
  }
}
