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

// Alias used throughout the module for schedule identifiers.
pub type ScheduleId = Uuid;
/// `starts`, `stops`) for compatibility and some linear-time operations.
///
/// Typical usage (internal to this crate): build a `Lapper`, insert
/// `Interval`s, then call `find(start, stop)` to iterate overlapping
/// intervals or `has_overlap(start, stop)` to test for any overlap.
mod lapper {
  use chrono::{DateTime, Utc};
  use serde::{Deserialize, Serialize};
  use std::collections::BTreeSet;

  use super::ScheduleId;

  /// A time interval associated with a value (a schedule id).
  ///
  /// Intervals are half-open: an interval `[start, stop)` contains times t
  /// with `start <= t < stop`. Intervals implement `Ord` and `Eq` so they
  /// can be sorted and kept in snapshot vectors.
  #[derive(PartialEq, Eq, PartialOrd, Ord, Debug, Clone, Serialize, Deserialize)]
  pub struct Interval {
    pub start: DateTime<Utc>,
    pub stop: DateTime<Utc>,
    pub val: ScheduleId,
  }

  impl Interval {
    /// Create a new interval, validating that start < stop.
    #[allow(dead_code)]
    pub fn new(start: DateTime<Utc>, stop: DateTime<Utc>, val: ScheduleId) -> Result<Self, String> {
      if start >= stop {
        return Err("Interval start must be before stop".to_string());
      }
      Ok(Interval { start, stop, val })
    }

    /// Returns true if this interval overlaps the half-open range
    /// `[start, stop)`.
    ///
    /// Overlap is defined as having any time in common: this interval's
    /// start must be before the query `stop` and this interval's stop
    /// must be after the query `start`.
    pub fn overlap(&self, start: DateTime<Utc>, stop: DateTime<Utc>) -> bool {
      self.start < stop && self.stop > start
    }
  }

  // Trait implementations for ordering and equality are derived above.

  /// An interval index that supports overlap queries and coverage checks.
  ///
  /// `Lapper` keeps an augmented binary search tree of `Interval` nodes for
  /// efficient overlap iteration and also maintains a sorted set of intervals
  /// for certain linear algorithms. The tree is the authoritative structure for
  /// lookups; the sorted set is updated incrementally on insert/remove operations.
  #[derive(Debug, Clone)]
  pub struct Lapper {
    /// Sorted set of intervals (sorted by (start, stop, val)).
    /// Uses BTreeSet for O(log n) insertions and efficient iteration.
    pub intervals: BTreeSet<Interval>,

    /// Root of the augmented BST used for fast overlap queries.
    root: Option<Box<Node>>,
  }

  /// Internal node of the augmented binary search tree.
  ///
  /// Each node stores an `Interval` (`iv`) and the maximum `stop` time
  /// (`max`) present in the subtree rooted at that node. `height` is used
  /// for AVL-style balancing. This type is private to the module.
  #[derive(Debug, Clone)]
  struct Node {
    iv: Interval,
    max: DateTime<Utc>,
    height: i32,
    left: Option<Box<Node>>,
    right: Option<Box<Node>>,
  }

  impl Node {
    /// Create a new leaf node from `iv`.
    fn new(iv: Interval) -> Self {
      let max = iv.stop;
      Node {
        iv,
        max,
        height: 1,
        left: None,
        right: None,
      }
    }

    /// Recompute `self.max` from this node and its children.
    ///
    /// Algorithm: the `max` value is an augmentation used for subtree
    /// pruning during overlap queries. It stores the maximum `stop`
    /// timestamp present anywhere in this node's subtree. On any
    /// structural change (insert/remove/rotation) we must recompute it
    /// by taking the max of this node's own interval end and the `max`
    /// values of the left and right children.
    fn update_max(&mut self) {
      let mut m = self.iv.stop;
      if let Some(ref l) = self.left {
        if l.max > m {
          m = l.max;
        }
      }
      if let Some(ref r) = self.right {
        if r.max > m {
          m = r.max;
        }
      }
      self.max = m;
    }

    /// Return height of `node` (0 for None).
    fn height(node: &Option<Box<Node>>) -> i32 {
      node.as_ref().map(|n| n.height).unwrap_or(0)
    }

    /// Recompute this node's height from its children's heights.
    ///
    /// Algorithm: height is used for AVL-style balancing. It is
    /// 1 + max(height(left), height(right)). Keeping heights exact
    /// allows us to compute balance factors efficiently when deciding
    /// which rotations to perform.
    fn update_height(&mut self) {
      let hl = Node::height(&self.left);
      let hr = Node::height(&self.right);
      self.height = 1 + hl.max(hr);
    }

    /// Balance factor = height(left) - height(right).
    fn balance_factor(&self) -> i32 {
      Node::height(&self.left) - Node::height(&self.right)
    }

    /// Perform a right rotation and return the new subtree root.
    fn rotate_right(mut self: Box<Self>) -> Box<Node> {
      debug_assert!(self.left.is_some(), "rotate_right without left");
      // SAFETY: The debug_assert above guarantees self.left is Some,
      // and rotate_right is only called from rebalance when balance factor > 1,
      // which only occurs when a left child exists.
      let mut l = unsafe { self.left.take().unwrap_unchecked() };
      self.left = l.right.take();
      // After splicing, update the moved subtree (self) before
      // attaching it as the right child of `l` so its height/max are
      // consistent. Then update `l` which becomes the new root.
      self.update_height();
      self.update_max();
      l.right = Some(self);
      l.update_height();
      l.update_max();
      l
    }

    /// Perform a left rotation and return the new subtree root.
    fn rotate_left(mut self: Box<Self>) -> Box<Node> {
      debug_assert!(self.right.is_some(), "rotate_left without right");
      // SAFETY: The debug_assert above guarantees self.right is Some,
      // and rotate_left is only called from rebalance when balance factor < -1,
      // which only occurs when a right child exists.
      let mut r = unsafe { self.right.take().unwrap_unchecked() };
      self.right = r.left.take();
      // Symmetric to rotate_right: fix-up `self` then `r` after
      // re-linking so invariants hold.
      self.update_height();
      self.update_max();
      r.left = Some(self);
      r.update_height();
      r.update_max();
      r
    }

    /// Rebalance this subtree if needed and return the new subtree root.
    ///
    /// Uses AVL rotation rules based on the balance factor.
    fn rebalance(mut self: Box<Self>) -> Box<Node> {
      // Recompute local metadata and inspect the balance factor.
      // If the node is unbalanced (|bf| > 1) perform appropriate
      // single or double rotations to restore AVL balance.
      // Double rotations are decomposed into a rotation on the
      // child followed by a rotation on `self`.
      self.update_height();
      self.update_max();
      let bf = self.balance_factor();
      if bf > 1 {
        // left heavy
        debug_assert!(self.left.is_some(), "left child must exist when left heavy");
        // SAFETY: AVL invariant guarantees that if balance factor > 1,
        // then left subtree height is at least 2 more than right subtree,
        // which means left child must exist.
        let left_ref = unsafe { self.left.as_ref().unwrap_unchecked() };
        if Node::height(&left_ref.right) > Node::height(&left_ref.left) {
          // SAFETY: We already verified self.left.is_some() above.
          // The map operation preserves the Some variant.
          let left = unsafe { self.left.take().map(|n| n.rotate_left()).unwrap_unchecked() };
          self.left = Some(left);
        }
        return self.rotate_right();
      }
      if bf < -1 {
        // right heavy
        debug_assert!(
          self.right.is_some(),
          "right child must exist when right heavy"
        );
        // SAFETY: AVL invariant guarantees that if balance factor < -1,
        // then right subtree height is at least 2 more than left subtree,
        // which means right child must exist.
        let right_ref = unsafe { self.right.as_ref().unwrap_unchecked() };
        if Node::height(&right_ref.left) > Node::height(&right_ref.right) {
          // SAFETY: We already verified self.right.is_some() above.
          // The map operation preserves the Some variant.
          let right = unsafe {
            self
              .right
              .take()
              .map(|n| n.rotate_right())
              .unwrap_unchecked()
          };
          self.right = Some(right);
        }
        return self.rotate_left();
      }
      self
    }

    /// Insert `elem` into this subtree and return the new subtree root.
    fn insert(mut self: Box<Self>, elem: Interval) -> Box<Node> {
      if elem < self.iv {
        if let Some(l) = self.left.take() {
          self.left = Some(l.insert(elem));
        } else {
          self.left = Some(Box::new(Node::new(elem)));
        }
      } else if let Some(r) = self.right.take() {
        self.right = Some(r.insert(elem));
      } else {
        self.right = Some(Box::new(Node::new(elem)));
      }
      // After insertion the subtree may become unbalanced. Call
      // `rebalance` which updates height/max and performs
      // rotations if necessary, returning the new subtree root.
      self.rebalance()
    }

    /// Remove `elem` from this subtree. Returns (new_subtree, removed_flag).
    ///
    /// The `removed_flag` is true when a node equal to `elem` was found and
    /// removed. The returned subtree is rebalanced when necessary.
    fn remove(self: Box<Self>, elem: &Interval) -> (Option<Box<Node>>, bool) {
      use std::cmp::Ordering::*;
      let mut node = *self;
      match elem.cmp(&node.iv) {
        Less => {
          if let Some(l) = node.left {
            let (nl, removed) = l.remove(elem);
            node.left = nl;
            if removed {
              let nboxed = Box::new(node);
              (Some(nboxed.rebalance()), true)
            } else {
              (Some(Box::new(node)), false)
            }
          } else {
            (Some(Box::new(node)), false)
          }
        }
        Greater => {
          if let Some(r) = node.right {
            let (nr, removed) = r.remove(elem);
            node.right = nr;
            if removed {
              let nboxed = Box::new(node);
              (Some(nboxed.rebalance()), true)
            } else {
              (Some(Box::new(node)), false)
            }
          } else {
            (Some(Box::new(node)), false)
          }
        }
        Equal => {
          // Remove this node
          match (node.left.take(), node.right.take()) {
            (None, None) => (None, true),
            (Some(l), None) => (Some(l), true),
            (None, Some(r)) => (Some(r), true),
            (Some(l), Some(r)) => {
              // Two-child case: replace this node's interval with
              // the inorder successor (minimum of right subtree).
              // This preserves BST ordering. After transplanting
              // the successor's interval, reattach the left
              // subtree and rebalance the resulting subtree.
              let (min_iv, nr) = Node::take_min(r);
              node.iv = min_iv;
              node.right = nr;
              node.left = Some(l);
              let mut nboxed = Box::new(node);
              nboxed = nboxed.rebalance();
              (Some(nboxed), true)
            }
          }
        }
      }
    }

    /// Extract minimum interval (leftmost) from subtree, returning
    /// `(min_interval, new_subtree)` where `new_subtree` is the subtree
    /// after removing that minimum node.
    fn take_min(mut node: Box<Node>) -> (Interval, Option<Box<Node>>) {
      if node.left.is_none() {
        let right = node.right.take();
        return (node.iv, right);
      }
      // Recurse left until we find the leftmost node. On unwinding,
      // update metadata for nodes along the path so heights and max
      // remain correct for future operations.
      debug_assert!(
        node.left.is_some(),
        "left child must exist when recursing in take_min"
      );
      // SAFETY: The debug_assert above guarantees node.left is Some.
      // This function is only called when we've already verified that
      // left child exists (either via the early return check above or
      // via recursive call from the two-child deletion case).
      let (min_iv, new_left) = Node::take_min(unsafe { node.left.take().unwrap_unchecked() });
      node.left = new_left;
      node.update_height();
      node.update_max();
      (min_iv, Some(node))
    }

    // inorder_collect removed (unused)

    // collect_overlaps removed (unused) — use OverlapIter instead
  }

  /// Iterator over intervals that overlap a query range.
  ///
  /// The iterator borrows the tree and yields `&Interval` without allocating
  /// a vector. It performs subtree pruning using the `max` augmentation to
  /// skip branches that cannot contain an overlap.
  pub struct OverlapIter<'a> {
    stack: Vec<&'a Node>,
    start: DateTime<Utc>,
    stop: DateTime<Utc>,
  }

  impl<'a> OverlapIter<'a> {
    /// Create a new overlap iterator for the half-open range `[start, stop)`.
    ///
    /// If `root` is `Some`, the iterator is initialized to traverse the
    /// leftmost chain so iteration yields intervals in order.
    fn new(root: Option<&'a Node>, start: DateTime<Utc>, stop: DateTime<Utc>) -> Self {
      // Algorithm: Use an explicit stack to perform an in-order traversal
      // over the BST while applying subtree pruning. We push the left
      // chain from the root so the next node to visit is at the top of
      // the stack. Actual overlap checks and pruning using the node `max`
      // values occur lazily in `next()` so iterator construction is cheap.
      let mut it = OverlapIter {
        stack: Vec::new(),
        start,
        stop,
      };
      if let Some(r) = root {
        it.push_left_chain(r);
      }
      it
    }

    /// Push a node and all its left descendants onto the internal stack.
    ///
    /// This prepares the iterator to visit nodes in-order starting from
    /// `node`.
    fn push_left_chain(&mut self, mut node: &'a Node) {
      // Walk left and push nodes so the top of the stack is the next
      // in-order node. This prepares traversal without performing any
      // overlap work until `next()` is called.
      loop {
        self.stack.push(node);
        if let Some(ref l) = node.left {
          node = l.as_ref();
        } else {
          break;
        }
      }
    }
  }

  impl<'a> Iterator for OverlapIter<'a> {
    type Item = &'a Interval;

    /// Advance the iterator and return the next interval that overlaps
    /// the query range, or `None` if iteration is complete.
    ///
    /// The iterator uses the `max` value to prune subtrees which cannot
    /// contain overlaps and stops early when remaining nodes start at or
    /// after the query `stop` time.
    ///
    /// ## Pruning Logic
    ///
    /// - If `node.max < self.start`: Skip entire subtree (no interval in
    ///   this subtree can overlap since all intervals end before query starts)
    /// - If `node.iv.start >= self.stop`: Skip this node and remaining nodes
    ///   (all subsequent nodes start at or after query ends)
    /// - Uses strict inequality (`<`) for `max` comparison to handle edge case
    ///   where intervals end exactly at query start time
    fn next(&mut self) -> Option<Self::Item> {
      while let Some(node) = self.stack.pop() {
        // traverse node: push right child's left chain
        if let Some(ref r) = node.right {
          self.push_left_chain(r.as_ref());
        }

        // pruning using subtree max: if node.max < start, skip
        if node.max < self.start {
          continue;
        }

        if node.iv.start >= self.stop {
          // node and all to its right start at/after stop, skip
          continue;
        }

        if node.iv.overlap(self.start, self.stop) {
          return Some(&node.iv);
        }
        // otherwise continue
      }
      None
    }
  }

  impl Lapper {
    /// Create a new `Lapper` from an initial list of intervals.
    ///
    /// This is a convenience wrapper over [`Lapper::from_vec`]. For large
    /// batches prefer `from_vec` which builds the balanced tree in O(n)
    /// after an O(n log n) sort. `new` preserves the previous incremental
    /// insertion semantics.
    pub fn new(intervals: BTreeSet<Interval>) -> Self {
      if intervals.len() <= 1 {
        let root = intervals
          .iter()
          .next()
          .cloned()
          .map(Node::new)
          .map(Box::new);
        return Lapper { intervals, root };
      }
      let root = Self::build_balanced(&intervals);
      Lapper { intervals, root }
    }

    /// Build a `Lapper` from an arbitrary (possibly unsorted) vector of intervals.
    ///
    /// Steps:
    /// 1. Insert intervals into BTreeSet (automatically sorted)
    /// 2. Build a perfectly balanced AVL tree in O(n) via divide & conquer
    /// 3. Compute `max` and `height` bottom-up
    ///
    /// Complexity: O(n log n) for BTreeSet insertion, O(n) for tree construction.
    /// This is more efficient than repeated individual insertions.
    #[allow(dead_code)]
    pub fn from_vec(intervals: Vec<Interval>) -> Self {
      let interval_set: BTreeSet<Interval> = intervals.into_iter().collect();
      if interval_set.len() <= 1 {
        let root = interval_set
          .iter()
          .next()
          .cloned()
          .map(Node::new)
          .map(Box::new);
        return Lapper {
          intervals: interval_set,
          root,
        };
      }
      // Build directly from the BTreeSet to avoid an extra sort/collect here.
      let root = Self::build_balanced(&interval_set);
      Lapper {
        intervals: interval_set,
        root,
      }
    }

    /// Internal: build a height-balanced tree from a sorted slice.
    fn build_balanced(intervals: &BTreeSet<Interval>) -> Option<Box<Node>> {
      // Convert to a sorted Vec and reuse the slice-based construction
      // logic so we can pick the middle element by index.
      if intervals.is_empty() {
        return None;
      }
      let sorted: Vec<_> = intervals.iter().cloned().collect();

      fn build_from_slice(slice: &[Interval]) -> Option<Box<Node>> {
        if slice.is_empty() {
          return None;
        }
        let mid = slice.len() / 2;
        let mut node = Box::new(Node::new(slice[mid].clone()));
        node.left = build_from_slice(&slice[..mid]);
        node.right = build_from_slice(&slice[mid + 1..]);
        // Recompute height/max based on children.
        node.update_height();
        node.update_max();
        Some(node)
      }

      build_from_slice(&sorted)
    }

    // rebuild_snapshots removed (unused)

    /// Insert multiple intervals efficiently.
    ///
    /// More efficient than calling `insert` repeatedly for large batches.
    ///
    /// # Complexity
    /// O(k log(n+k)) where n is current size and k is number of new intervals.
    #[allow(dead_code)]
    pub fn insert_batch(&mut self, new_intervals: Vec<Interval>) {
      if new_intervals.is_empty() {
        return;
      }

      // Insert all new intervals into BTreeSet
      for interval in new_intervals {
        self.intervals.insert(interval);
      }

      // Rebuild the BST from the updated BTreeSet
      self.root = Self::build_balanced(&self.intervals);
    }

    /// Insert a single interval into the index.
    ///
    /// The interval is inserted into the augmented BST (rebalance is
    /// performed) and into the BTreeSet keeping it sorted.
    /// `elem` is cloned as needed.
    ///
    /// # Complexity
    /// - BST insertion: O(log n) average, O(n) worst case (unbalanced)
    /// - BTreeSet insertion: O(log n) guaranteed
    pub fn insert(&mut self, elem: Interval) {
      // Insert into BTreeSet - O(log n) guaranteed performance
      self.intervals.insert(elem.clone());

      // Insert into AVL tree. We move `elem` here.
      self.root = Some(match self.root.take() {
        Some(r) => r.insert(elem),
        None => Box::new(Node::new(elem)),
      });
    }

    /// Remove a single interval equal to `elem` from the index.
    ///
    /// Returns `true` if an equal interval was found and removed. The
    /// operation updates both the BST and the BTreeSet.
    ///
    /// # Complexity
    /// - BST removal: O(log n) average
    /// - BTreeSet removal: O(log n) guaranteed
    pub fn remove(&mut self, elem: &Interval) -> bool {
      // Remove from the augmented BST. The tree's `remove` returns the
      // new subtree root and a flag indicating whether a node was found
      // and removed. If removed, we must also delete one matching entry
      // from the BTreeSet. BTreeSet automatically maintains uniqueness
      // so duplicates with identical start/stop but different `val` are
      // naturally preserved.
      if let Some(r) = self.root.take() {
        let (nr, removed) = r.remove(elem);
        self.root = nr;
        if removed {
          // Remove from BTreeSet - O(log n) guaranteed performance
          self.intervals.remove(elem);
        }
        return removed;
      }
      false
    }
    /// Find intervals that overlap the query range `[start, stop)`.
    ///
    /// Returns an `OverlapIter` that borrows the tree and yields
    /// `&Interval` references without allocating a `Vec`.
    pub fn find(&self, start: DateTime<Utc>, stop: DateTime<Utc>) -> OverlapIter<'_> {
      // Return an iterator that traverses the BST in-order but prunes
      // entire subtrees whose `max` end-time is <= query `start`.
      // This yields only intervals that might overlap the query range
      // and avoids allocating temporary vectors for most queries.
      OverlapIter::new(self.root.as_deref(), start, stop)
    }

    // `lower_bound` removed: use `slice.partition_point(|iv| iv.start < start)` directly

    // `is_covered` removed: use `has_overlap` or external coverage checks

    /// Return true if there exists at least one interval that overlaps the
    /// half-open range `[start, stop)`.
    ///
    /// This provides a lightweight overlap predicate used by higher-level
    /// schedule validation where *any* overlap is disallowed (in contrast to
    /// `is_covered` which checks full coverage). Implementation delegates to
    /// the BST-backed iterator and stops after finding the first overlap.
    pub fn has_overlap(&self, start: DateTime<Utc>, stop: DateTime<Utc>) -> bool {
      if start >= stop {
        return false;
      }
      self.find(start, stop).next().is_some()
    }
  }

  // Custom serialization to ensure BST consistency
  // Note: Only `intervals` is serialized since the BST can be rebuilt
  // efficiently during deserialization via balanced tree construction
  impl Serialize for Lapper {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
      S: serde::Serializer,
    {
      use serde::ser::SerializeStruct;

      // Serialize the BTreeSet as a vector to maintain compatibility
      // and will be rebuilt during deserialization
      // let intervals_vec: Vec<_> = self.intervals.iter().cloned().collect();
      let mut state = serializer.serialize_struct("Lapper", 1)?;
      state.serialize_field("intervals", &self.intervals)?;
      state.end()
    }
  }

  impl<'de> Deserialize<'de> for Lapper {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
      D: serde::Deserializer<'de>,
    {
      // Deserialize into a small helper then rebuild the interval set and
      // the balanced AVL tree using existing helpers. This avoids the
      // Visitor/MapAccess boilerplate while preserving compatibility with
      // the `serialize` implementation which writes an `intervals` field.
      #[derive(Deserialize)]
      struct Helper {
        intervals: Vec<Interval>,
      }

      let helper = Helper::deserialize(deserializer)?;
      let interval_set: BTreeSet<Interval> = helper.intervals.into_iter().collect();
      let root = Lapper::build_balanced(&interval_set);
      Ok(Lapper {
        intervals: interval_set,
        root,
      })
    }
  }

  #[cfg(test)]
  mod tests {
    use super::*;
    use chrono::Duration;
    use uuid::Uuid;

    /// Creates a test interval with the given start, duration (in hours), and a new UUID.
    fn create_interval(start: DateTime<Utc>, duration_hours: i64) -> Interval {
      Interval {
        start,
        stop: start + Duration::hours(duration_hours),
        val: Uuid::now_v7(),
      }
    }

    /// Creates a test interval with a specific UUID.
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

    mod interval_tests {
      use super::*;

      #[test]
      fn new_validates_start_before_stop() {
        let start = Utc::now();
        let id = Uuid::now_v7();

        // Valid interval
        assert!(Interval::new(start, start + Duration::hours(1), id).is_ok());

        // Invalid: start == stop
        assert!(Interval::new(start, start, id).is_err());

        // Invalid: start > stop
        assert!(Interval::new(start + Duration::hours(1), start, id).is_err());
      }

      #[test]
      fn new_validates_extreme_time_ranges() {
        let id = Uuid::now_v7();

        // Test with very distant past and future
        let year_1970 = DateTime::from_timestamp(0, 0).unwrap();
        let year_2100 = DateTime::from_timestamp(4102444800, 0).unwrap();

        // Valid extreme range
        assert!(Interval::new(year_1970, year_2100, id).is_ok());

        // Invalid: future before past
        assert!(Interval::new(year_2100, year_1970, id).is_err());
      }

      #[test]
      fn new_validates_minimal_duration() {
        let start = Utc::now();
        let id = Uuid::now_v7();

        // Minimal valid duration (1 nanosecond)
        assert!(Interval::new(start, start + Duration::nanoseconds(1), id).is_ok());

        // Invalid: negative duration
        assert!(Interval::new(start, start - Duration::nanoseconds(1), id).is_err());
      }

      #[test]
      fn overlap_detects_overlapping_ranges() {
        let start = Utc::now();
        let interval = create_interval_with_id(
          start + Duration::hours(1),
          2, // duration: 1 hour to 3 hours
          Uuid::now_v7(),
        );

        // No overlap: query ends before interval starts
        assert!(!interval.overlap(start, start + Duration::hours(1)));

        // No overlap: query starts after interval ends
        assert!(!interval.overlap(start + Duration::hours(3), start + Duration::hours(4)));

        // Overlap: query starts before and ends during interval
        assert!(interval.overlap(start, start + Duration::hours(2)));

        // Overlap: query starts during and ends after interval
        assert!(interval.overlap(start + Duration::hours(2), start + Duration::hours(4)));

        // Overlap: query completely contains interval
        assert!(interval.overlap(start, start + Duration::hours(4)));

        // Overlap: interval completely contains query
        assert!(interval.overlap(
          start + Duration::hours(1) + Duration::minutes(30),
          start + Duration::hours(2) + Duration::minutes(30)
        ));
      }

      #[test]
      fn overlap_with_minimal_durations() {
        let start = Utc::now();
        let id = Uuid::now_v7();

        // Interval with 1 nanosecond duration
        let tiny_interval = Interval {
          start,
          stop: start + Duration::nanoseconds(1),
          val: id,
        };

        // Should overlap with itself
        assert!(tiny_interval.overlap(start, start + Duration::nanoseconds(1)));

        // Should not overlap with adjacent nanosecond
        assert!(!tiny_interval.overlap(
          start + Duration::nanoseconds(1),
          start + Duration::nanoseconds(2)
        ));

        // Should overlap with containing range
        assert!(tiny_interval.overlap(start - Duration::seconds(1), start + Duration::seconds(1)));
      }

      #[test]
      fn overlap_with_same_uuid_different_times() {
        let start = Utc::now();
        let id = Uuid::now_v7();

        let interval1 = Interval {
          start,
          stop: start + Duration::hours(1),
          val: id,
        };

        let interval2 = Interval {
          start: start + Duration::hours(2),
          stop: start + Duration::hours(3),
          val: id, // Same UUID, different time
        };

        // They shouldn't overlap with each other
        assert!(!interval1.overlap(interval2.start, interval2.stop));
        assert!(!interval2.overlap(interval1.start, interval1.stop));
      }

      #[test]
      fn overlap_respects_half_open_intervals() {
        let start = Utc::now();
        let interval = create_interval_with_id(
          start + Duration::hours(1),
          2, // [1h, 3h)
          Uuid::now_v7(),
        );

        // Edge case: query starts exactly when interval ends (no overlap)
        assert!(!interval.overlap(start + Duration::hours(3), start + Duration::hours(4)));

        // Edge case: query ends exactly when interval starts (no overlap)
        assert!(!interval.overlap(start, start + Duration::hours(1)));
      }
    }

    // (other tests omitted for brevity in this helper test module)
  }
}

// Keep Interval/Lapper available in this file (module is private).
use lapper::{Interval, Lapper};

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
  start: DateTime<Utc>,
  /// Exclusive end time of the schedule interval.
  end: DateTime<Utc>,
  /// Numeric hierarchy level of the schedule. Lower numbers indicate
  /// higher-level (parent) schedules.
  level: ScheduleLevel,
  /// When true indicates this schedule must not be overlapped by other
  /// schedules at the same or lower levels (enforced by the manager).
  exclusive: bool,
  /// Human-readable name for the schedule.
  name: String,
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
#[derive(Serialize, Deserialize)]
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
    // Validate schedule time range
    if schedule.start > schedule.end {
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

    // Check for overlaps with exclusive schedules at higher levels
    for level in (0..=schedule.level).rev() {
      if let Some(lapper) = self.exclusive_index.get(&level) {
        if lapper.has_overlap(schedule.start, schedule.end) {
          return Err(ScheduleError::TimeRangeOverlaps);
        }
      }
    }

    // If this schedule is exclusive, check for overlaps with any schedules at same or lower levels
    if schedule.exclusive {
      for (_, lapper) in self.all_index.range(schedule.level..) {
        if lapper.has_overlap(schedule.start, schedule.end) {
          return Err(ScheduleError::TimeRangeOverlaps);
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

      lapper.insert(Interval {
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

    lapper.insert(Interval {
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
      // SAFETY: The debug_assert above guarantees the key exists in the map.
      // The exclusive_index is populated for all schedule levels during
      // ScheduleManager initialization and maintained as an invariant.
      let lapper = unsafe {
        self
          .exclusive_index
          .get_mut(&schedule.level)
          .unwrap_unchecked()
      };

      lapper.remove(&Interval {
        start: schedule.start,
        stop: schedule.end,
        val: schedule_id,
      });
    }

    debug_assert!(
      self.all_index.contains_key(&schedule.level),
      "internal invariant: missing all index for schedule level"
    );
    // SAFETY: The debug_assert above guarantees the key exists in the map.
    // The all_index is populated for all schedule levels during
    // ScheduleManager initialization and maintained as an invariant.
    let lapper = unsafe { self.all_index.get_mut(&schedule.level).unwrap_unchecked() };

    lapper.remove(&Interval {
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

#[cfg(test)]
mod tests {
  use chrono::Duration;
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
}
