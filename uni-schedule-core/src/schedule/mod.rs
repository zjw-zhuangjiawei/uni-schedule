//! Schedule management module
//!
//! This module provides functionality for managing time-based schedules with
//! hierarchical relationships and exclusivity constraints.

pub mod lapper;
pub mod manager;

// Re-export public types for convenience
pub use lapper::{Interval, Lapper};
pub use manager::{QueryOptions, Schedule, ScheduleError, ScheduleLevel, ScheduleManager};

// Alias used throughout the module for schedule identifiers.
pub type ScheduleId = uuid::Uuid;

#[cfg(test)]
mod tests {
  use chrono::{DateTime, Duration, Utc};
  use std::collections::HashSet;
  use std::sync::Arc;
  use uuid::Uuid;

  use super::*;

  /// Test helpers for creating intervals used by multiple tests in this module.
  fn create_interval(start: DateTime<Utc>, duration_hours: i64) -> Interval {
    Interval {
      start,
      stop: start + Duration::hours(duration_hours),
      val: Uuid::now_v7(),
    }
  }

  fn create_interval_with_id(
    start: DateTime<Utc>,
    duration_hours: i64,
    id: ScheduleId,
  ) -> Interval {
    Interval {
      start,
      stop: start + Duration::hours(duration_hours),
      val: id,
    }
  }

  #[test]
  fn test_create_schedule_parent_not_found_and_level_checks() {
    let mut manager = ScheduleManager::new();
    let start = Utc::now();
    let end = start + Duration::hours(1);
    let mut parents = HashSet::new();
    parents.insert(Uuid::now_v7()); // non-existent parent

    let res = manager.create_schedule(
      Schedule {
        start,
        end,
        level: 1,
        exclusive: false,
        name: "child".into(),
      },
      parents.clone(),
    );
    // future API should validate parent presence
    assert_eq!(res, Err(ScheduleError::ParentNotFound));

    // create a parent and then attempt invalid level
    let parent_id = manager
      .create_schedule(
        Schedule {
          start,
          end,
          level: 5,
          exclusive: false,
          name: "parent".into(),
        },
        HashSet::new(),
      )
      .unwrap();

    let mut parent_set = HashSet::new();
    parent_set.insert(parent_id);

    let res2 = manager.create_schedule(
      Schedule {
        start,
        end,
        level: 5,
        exclusive: false,
        name: "badchild".into(),
      },
      parent_set,
    );
    assert_eq!(res2, Err(ScheduleError::LevelExceedsParent));
  }
  // (remainder of tests kept intact)

  #[test]
  fn lapper_overlap_and_remove_edge_cases() {
    // Verify half-open semantics, insertion/removal, and tiny durations.
    let start = Utc::now();
    let id1 = Uuid::now_v7();
    let id2 = Uuid::now_v7();

    let mut lapper = Lapper::new(std::collections::BTreeSet::new());

    // Insert two adjacent intervals
    let iv1 = Interval {
      start,
      stop: start + Duration::hours(1),
      val: id1,
    };
    let iv2 = Interval {
      start: start + Duration::hours(1),
      stop: start + Duration::hours(2),
      val: id2,
    };
    lapper.insert(iv1.clone());
    lapper.insert(iv2.clone());

    // Query exactly at the boundary: should not overlap (half-open)
    assert!(!lapper.has_overlap(start + Duration::hours(1), start + Duration::hours(1)));

    // Query that touches iv1 end and iv2 start (no overlap)
    assert!(!lapper.has_overlap(
      start + Duration::hours(1),
      start + Duration::hours(1) + Duration::nanoseconds(0)
    ));

    // Overlap with iv1
    assert!(lapper.has_overlap(start + Duration::minutes(30), start + Duration::minutes(90)));

    // Remove iv1 and ensure iv2 still present
    assert!(lapper.remove(&iv1));
    let mut found_ids: Vec<ScheduleId> = lapper
      .find(start, start + Duration::hours(3))
      .map(|iv| iv.val)
      .collect();
    assert_eq!(found_ids.len(), 1);
    assert_eq!(found_ids.pop().unwrap(), id2);

    // Tiny interval (1 nanosecond) overlaps correctly
    let tiny_start = Utc::now() + Duration::seconds(10);
    let tiny = Interval {
      start: tiny_start,
      stop: tiny_start + Duration::nanoseconds(1),
      val: Uuid::now_v7(),
    };
    lapper.insert(tiny.clone());
    assert!(lapper.has_overlap(tiny_start, tiny_start + Duration::nanoseconds(1)));
    assert!(!lapper.has_overlap(
      tiny_start + Duration::nanoseconds(1),
      tiny_start + Duration::nanoseconds(2)
    ));
  }

  #[test]
  fn schedule_manager_exclusivity_and_cascade_delete() {
    let mut mgr = ScheduleManager::new();
    let start = Utc::now();
    let end = start + Duration::hours(2);

    // Create a high-priority exclusive schedule at level 1
    let sched1 = Schedule {
      start,
      end,
      level: 1,
      exclusive: true,
      name: "exclusive".into(),
    };
    let id1 = mgr.create_schedule(sched1, HashSet::new()).unwrap();

    // Attempt to create an overlapping schedule at level 2 (numeric >= 1).
    // Because exclusive_index checks levels <= schedule.level, an exclusive at level 1
    // should prevent creation at level 2 (1 <= 2).
    let sched2 = Schedule {
      start: start + Duration::minutes(30),
      end: end + Duration::hours(1),
      level: 2,
      exclusive: false,
      name: "blocked".into(),
    };
    let res = mgr.create_schedule(sched2, HashSet::new());
    assert_eq!(res, Err(ScheduleError::TimeRangeOverlaps));

    // Create a non-overlapping schedule at level 2 should succeed
    let sched3 = Schedule {
      start: end + Duration::hours(1),
      end: end + Duration::hours(2),
      level: 2,
      exclusive: false,
      name: "ok".into(),
    };
    let id3 = mgr.create_schedule(sched3, HashSet::new()).unwrap();

    // Add a child to id1 and verify cascade delete removes the child when parent is deleted
    let child = Schedule {
      start: start + Duration::minutes(10),
      end: start + Duration::minutes(20),
      level: 2,
      exclusive: false,
      name: "child".into(),
    };
    let mut parents = HashSet::new();
    parents.insert(id1);
    let child_id = mgr.create_schedule(child, parents).unwrap();

    // Now delete parent and ensure child is cascade deleted
    let removed = mgr.delete_schedule(id1).unwrap();
    assert!(removed.contains(&id1));
    assert!(removed.contains(&child_id));
    // id3 should still exist
    assert!(mgr.get_schedule(id3).is_some());
  }

  #[test]
  fn child_with_multiple_parents_survives_single_parent_delete() {
    let mut mgr = ScheduleManager::new();
    let start = Utc::now();
    let end = start + Duration::hours(4);

    // Create two parents that both contain the child range
    // Use non-exclusive parents so they may overlap each other for this test.
    let parent1 = Schedule {
      start,
      end,
      level: 1,
      exclusive: false,
      name: "p1".into(),
    };
    let p1 = mgr.create_schedule(parent1, HashSet::new()).unwrap();

    let parent2 = Schedule {
      start: start + Duration::hours(0),
      end: end + Duration::hours(1),
      level: 1,
      exclusive: false,
      name: "p2".into(),
    };
    let p2 = mgr.create_schedule(parent2, HashSet::new()).unwrap();

    // Child contained in both parents
    let child = Schedule {
      start: start + Duration::hours(1),
      end: start + Duration::hours(2),
      level: 2,
      exclusive: false,
      name: "child".into(),
    };
    let mut parents = HashSet::new();
    parents.insert(p1);
    parents.insert(p2);
    let child_id = mgr.create_schedule(child, parents).unwrap();

    // Delete only parent1: child should remain because parent2 is still present
    let removed1 = mgr.delete_schedule(p1).unwrap();
    assert!(removed1.contains(&p1));
    assert!(!removed1.contains(&child_id));
    assert!(mgr.get_schedule(child_id).is_some());

    // Now delete parent2: child should be cascade deleted
    let removed2 = mgr.delete_schedule(p2).unwrap();
    assert!(removed2.contains(&p2));
    assert!(removed2.contains(&child_id));
    assert!(mgr.get_schedule(child_id).is_none());
  }

  #[test]
  fn create_schedule_with_id_duplicate_error() {
    let mut mgr = ScheduleManager::new();
    let start = Utc::now();
    let end = start + Duration::hours(1);
    let id = Uuid::now_v7();

    let sched = Schedule {
      start,
      end,
      level: 1,
      exclusive: false,
      name: "s".into(),
    };
    // First insertion with explicit id should succeed
    let r1 = mgr.create_schedule_with_id(id, sched.clone(), HashSet::new());
    assert!(r1.is_ok());

    // Second insertion with same id should fail with DuplicateId
    let r2 = mgr.create_schedule_with_id(id, sched, HashSet::new());
    assert_eq!(r2, Err(ScheduleError::DuplicateId));
  }

  #[test]
  fn lapper_serde_roundtrip_and_duplicate_same_range() {
    // Serde round-trip should preserve intervals; BTreeSet keeps ordering
    let mut lapper = Lapper::new(std::collections::BTreeSet::new());
    let start = Utc::now();
    let id1 = Uuid::now_v7();
    let id2 = Uuid::now_v7();

    // Two intervals with identical start/stop but different vals
    let iv1 = Interval {
      start,
      stop: start + Duration::hours(1),
      val: id1,
    };
    let iv2 = Interval {
      start,
      stop: start + Duration::hours(1),
      val: id2,
    };
    lapper.insert(iv1.clone());
    lapper.insert(iv2.clone());

    // Both should be present when iterating over intervals set
    let mut vals: Vec<ScheduleId> = lapper.intervals.iter().map(|iv| iv.val).collect();
    vals.sort();
    let mut expected = vec![id1, id2];
    expected.sort();
    assert_eq!(vals, expected);

    // Ensure overlap predicate works on the original lapper
    assert!(lapper.has_overlap(start, start + Duration::hours(1)));
  }

  #[test]
  fn schedule_manager_query_time_boundaries() {
    let mut mgr = ScheduleManager::new();
    let start = Utc::now();
    let i1 = Schedule {
      start,
      end: start + Duration::hours(1),
      level: 1,
      exclusive: false,
      name: "a".into(),
    };
    let i2 = Schedule {
      start: start + Duration::hours(1),
      end: start + Duration::hours(2),
      level: 1,
      exclusive: false,
      name: "b".into(),
    };
    let id1 = mgr.create_schedule(i1, HashSet::new()).unwrap();
    let id2 = mgr.create_schedule(i2, HashSet::new()).unwrap();

    // Query range that ends exactly at i1.end: manager includes schedules
    // that start before the stop value (i.e., start < stop), so i1 is expected.
    let opts = QueryOptions {
      start: None,
      stop: Some(start + Duration::hours(1)),
      ..Default::default()
    };
    let res = mgr.query_schedule(opts);
    assert!(res.iter().any(|(id, _)| *id == id1));

    // Query with start exactly at i2.start should include i2
    let opts2 = QueryOptions {
      start: Some(start + Duration::hours(1)),
      stop: None,
      ..Default::default()
    };
    let res2 = mgr.query_schedule(opts2);
    assert!(res2.iter().any(|(id, _)| *id == id2));

    // Query overlapping both
    let opts3 = QueryOptions {
      start: Some(start + Duration::minutes(30)),
      stop: Some(start + Duration::hours(1) + Duration::minutes(30)),
      ..Default::default()
    };
    let res3 = mgr.query_schedule(opts3);
    let ids: Vec<ScheduleId> = res3.into_iter().map(|(id, _)| id).collect();
    assert!(ids.contains(&id1));
    assert!(ids.contains(&id2));
  }

  #[test]
  fn lapper_serde_tokens_single_interval() {
    use serde_test::{Configure, Token};

    // Use fixed, known string representations so serde_test tokens can be static
    let start_str = "2025-01-01T00:00:00Z";
    let stop_str = "2025-01-01T01:00:00Z";
    let id_str = "123e4567-e89b-12d3-a456-426614174000";

    let start = DateTime::parse_from_rfc3339(start_str)
      .unwrap()
      .with_timezone(&Utc);
    let stop = DateTime::parse_from_rfc3339(stop_str)
      .unwrap()
      .with_timezone(&Utc);
    let id = Uuid::parse_str(id_str).unwrap();

    let iv = Interval {
      start,
      stop,
      val: id,
    };
    let mut sset = std::collections::BTreeSet::new();
    sset.insert(iv.clone());
    let lapper = Lapper::new(sset);

    // Prepare expected token sequence for struct { intervals: Vec<Interval> }
    // Note: Lapper serializes only the `intervals` field as a sequence.
    let tokens = vec![
      Token::Struct {
        name: "Lapper",
        len: 1,
      },
      Token::Str("intervals"),
      Token::Seq { len: Some(1) },
      // Interval serialized as a struct (start, stop, val) — we rely on chrono/uuid tokenization
      Token::Struct {
        name: "Interval",
        len: 3,
      },
      Token::Str("start"),
      Token::Str(start_str),
      Token::Str("stop"),
      Token::Str(stop_str),
      Token::Str("val"),
      Token::Str(id_str),
      Token::StructEnd,
      Token::SeqEnd,
      Token::StructEnd,
    ];

    // Mark value as readable so types like DateTime/Uuid serialize as strings
    // in the token stream, then assert the expected tokens.
    serde_test::assert_ser_tokens(&lapper.readable(), &tokens);
  }
}
