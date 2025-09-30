use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use uuid::Uuid;

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
    // Use safe extraction preserving the debug_assert invariant.
    let mut l = self.left.take().expect("rotate_right without left");
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
    // Use safe extraction preserving the debug_assert invariant.
    let mut r = self.right.take().expect("rotate_left without right");
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
      // Safe access to left child reference for height inspection.
      let left_ref = self
        .left
        .as_ref()
        .expect("left child must exist when left heavy");
      if Node::height(&left_ref.right) > Node::height(&left_ref.left) {
        // Perform rotation on the left child safely.
        if let Some(left_child) = self.left.take() {
          let rotated = left_child.rotate_left();
          self.left = Some(rotated);
        }
      }
      return self.rotate_right();
    }
    if bf < -1 {
      // right heavy
      debug_assert!(
        self.right.is_some(),
        "right child must exist when right heavy"
      );
      // Safe access to right child reference for height inspection.
      let right_ref = self
        .right
        .as_ref()
        .expect("right child must exist when right heavy");
      if Node::height(&right_ref.left) > Node::height(&right_ref.right) {
        // Perform rotation on the right child safely.
        if let Some(right_child) = self.right.take() {
          let rotated = right_child.rotate_right();
          self.right = Some(rotated);
        }
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
    // The debug_assert above guarantees node.left is Some.
    // Extract left child safely using `expect` to preserve the invariant
    // while avoiding unsafe code.
    let left_child = node
      .left
      .take()
      .expect("left child must exist when recursing in take_min");
    let (min_iv, new_left) = Node::take_min(left_child);
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
    // entire subtrees whose `max` end-time is strictly less than the
    // query `start`. This yields only intervals that might overlap
    // the query range and avoids allocating temporary vectors.
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
