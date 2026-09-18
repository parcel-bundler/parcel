//! Dense bit matrices in one flat allocation, with borrowed row views that
//! interoperate with `FixedBitSet` scratch rows through their block slices.

use std::fmt;
use std::hash::{Hash, Hasher};
use std::ops::{Index, IndexMut};

use fixedbitset::{Block, FixedBitSet};

const BITS: usize = Block::BITS as usize;

/// A borrowed row of bits: a `BitMatrix` row or any equal-width bitset viewed
/// as blocks. Bits past a row's width are always zero, so counting, iteration,
/// equality, and hashing need no explicit width. Binary operations require
/// operands of equal width, which means equal block counts: `FixedBitSet`
/// exposes exactly `ceil(len / Block::BITS)` blocks, matching a matrix row.
#[repr(transparent)]
pub struct BitRow([Block]);

impl BitRow {
  pub fn from_blocks(blocks: &[Block]) -> &BitRow {
    // SAFETY: `BitRow` is a transparent wrapper around `[Block]`.
    unsafe { &*(blocks as *const [Block] as *const BitRow) }
  }

  pub fn from_blocks_mut(blocks: &mut [Block]) -> &mut BitRow {
    // SAFETY: `BitRow` is a transparent wrapper around `[Block]`.
    unsafe { &mut *(blocks as *mut [Block] as *mut BitRow) }
  }

  pub fn blocks(&self) -> &[Block] {
    &self.0
  }

  pub fn blocks_mut(&mut self) -> &mut [Block] {
    &mut self.0
  }

  #[inline]
  pub fn contains(&self, bit: usize) -> bool {
    self
      .0
      .get(bit / BITS)
      .is_some_and(|block| block & (1 << (bit % BITS)) != 0)
  }

  #[inline]
  pub fn insert(&mut self, bit: usize) {
    self.0[bit / BITS] |= 1 << (bit % BITS);
  }

  #[inline]
  pub fn set(&mut self, bit: usize, enabled: bool) {
    let block = &mut self.0[bit / BITS];
    let mask = 1 << (bit % BITS);
    if enabled {
      *block |= mask;
    } else {
      *block &= !mask;
    }
  }

  /// Insert a bit and return whether it was already set.
  #[inline]
  pub fn put(&mut self, bit: usize) -> bool {
    let block = &mut self.0[bit / BITS];
    let mask = 1 << (bit % BITS);
    let present = *block & mask != 0;
    *block |= mask;
    present
  }

  pub fn clear(&mut self) {
    self.0.fill(0);
  }

  // Predicates fold with `|` instead of short-circuiting: LLVM vectorizes the
  // branchless reduction but not an early-exit loop, and rows are short enough
  // that finishing the scan is cheaper than a mispredicted exit.
  pub fn is_clear(&self) -> bool {
    self.0.iter().fold(0, |acc, &block| acc | block) == 0
  }

  pub fn count_ones(&self) -> usize {
    self.0.iter().map(|block| block.count_ones() as usize).sum()
  }

  pub fn ones(&self) -> Ones<std::iter::Copied<std::slice::Iter<'_, Block>>> {
    Ones::new(self.0.iter().copied())
  }

  /// Bits set in `self` but not in `other`.
  pub fn difference<'a>(&'a self, other: &'a BitRow) -> Ones<impl Iterator<Item = Block> + 'a> {
    self.combined(other, |a, b| a & !b)
  }

  /// Bits set in both `self` and `other`.
  pub fn intersection<'a>(&'a self, other: &'a BitRow) -> Ones<impl Iterator<Item = Block> + 'a> {
    self.combined(other, |a, b| a & b)
  }

  #[inline]
  fn combined<'a>(
    &'a self,
    other: &'a BitRow,
    f: impl Fn(Block, Block) -> Block + 'a,
  ) -> Ones<impl Iterator<Item = Block> + 'a> {
    debug_assert_eq!(self.0.len(), other.0.len());
    Ones::new(self.0.iter().zip(&other.0).map(move |(&a, &b)| f(a, b)))
  }

  pub fn union_with(&mut self, other: &BitRow) {
    debug_assert_eq!(self.0.len(), other.0.len());
    for (a, b) in self.0.iter_mut().zip(&other.0) {
      *a |= *b;
    }
  }

  pub fn intersect_with(&mut self, other: &BitRow) {
    debug_assert_eq!(self.0.len(), other.0.len());
    for (a, b) in self.0.iter_mut().zip(&other.0) {
      *a &= *b;
    }
  }

  /// Intersect and report whether any bit was removed.
  pub fn intersect_changed(&mut self, other: &BitRow) -> bool {
    debug_assert_eq!(self.0.len(), other.0.len());
    let mut changed = false;
    for (a, b) in self.0.iter_mut().zip(&other.0) {
      let next = *a & *b;
      changed |= next != *a;
      *a = next;
    }
    changed
  }

  pub fn difference_with(&mut self, other: &BitRow) {
    debug_assert_eq!(self.0.len(), other.0.len());
    for (a, b) in self.0.iter_mut().zip(&other.0) {
      *a &= !*b;
    }
  }

  pub fn copy_from(&mut self, other: &BitRow) {
    self.0.copy_from_slice(&other.0);
  }

  /// Overwrite with `a | b` in one pass.
  pub fn copy_union_from(&mut self, a: &BitRow, b: &BitRow) {
    debug_assert_eq!(self.0.len(), a.0.len());
    debug_assert_eq!(self.0.len(), b.0.len());
    for ((dst, a), b) in self.0.iter_mut().zip(&a.0).zip(&b.0) {
      *dst = *a | *b;
    }
  }

  pub fn is_subset(&self, other: &BitRow) -> bool {
    debug_assert_eq!(self.0.len(), other.0.len());
    self
      .0
      .iter()
      .zip(&other.0)
      .fold(0, |acc, (a, b)| acc | (*a & !*b))
      == 0
  }

  pub fn is_disjoint(&self, other: &BitRow) -> bool {
    debug_assert_eq!(self.0.len(), other.0.len());
    self
      .0
      .iter()
      .zip(&other.0)
      .fold(0, |acc, (a, b)| acc | (*a & *b))
      == 0
  }

  pub fn intersection_count(&self, other: &BitRow) -> usize {
    debug_assert_eq!(self.0.len(), other.0.len());
    self
      .0
      .iter()
      .zip(&other.0)
      .map(|(a, b)| (*a & *b).count_ones() as usize)
      .sum()
  }
}

impl PartialEq for BitRow {
  fn eq(&self, other: &Self) -> bool {
    self.0 == other.0
  }
}

impl Eq for BitRow {}

impl Hash for BitRow {
  fn hash<H: Hasher>(&self, state: &mut H) {
    self.0.hash(state);
  }
}

impl fmt::Debug for BitRow {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.debug_set().entries(self.ones()).finish()
  }
}

impl ToOwned for BitRow {
  type Owned = Box<BitRow>;

  fn to_owned(&self) -> Box<BitRow> {
    let blocks: Box<[Block]> = self.0.into();
    // SAFETY: `BitRow` is a transparent wrapper around `[Block]`.
    unsafe { Box::from_raw(Box::into_raw(blocks) as *mut BitRow) }
  }
}

/// View a `FixedBitSet` as a row so it can operate on matrix rows directly.
pub trait AsBitRow {
  fn bits(&self) -> &BitRow;
  fn bits_mut(&mut self) -> &mut BitRow;
}

impl AsBitRow for FixedBitSet {
  fn bits(&self) -> &BitRow {
    BitRow::from_blocks(self.as_slice())
  }

  // Row operations only combine equal-width operands, so the unused bits
  // `FixedBitSet` requires to stay zero are never set. `as_mut_slice` exposes
  // exactly the blocks a matrix row of the same width has.
  fn bits_mut(&mut self) -> &mut BitRow {
    BitRow::from_blocks_mut(self.as_mut_slice())
  }
}

/// Indices of the set bits in a block sequence, in increasing order.
pub struct Ones<I> {
  blocks: I,
  current: Block,
  base: usize,
}

impl<I: Iterator<Item = Block>> Ones<I> {
  fn new(blocks: I) -> Self {
    Ones {
      blocks,
      current: 0,
      base: 0usize.wrapping_sub(BITS),
    }
  }
}

impl<I: Iterator<Item = Block>> Iterator for Ones<I> {
  type Item = usize;

  #[inline]
  fn next(&mut self) -> Option<usize> {
    while self.current == 0 {
      self.current = self.blocks.next()?;
      self.base = self.base.wrapping_add(BITS);
    }
    let bit = self.current.trailing_zeros() as usize;
    self.current &= self.current - 1;
    Some(self.base + bit)
  }
}

/// A fixed-size matrix of bits stored row-major in one allocation. Rows are
/// padded to whole blocks; the padding bits stay zero.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct BitMatrix {
  blocks: Vec<Block>,
  rows: usize,
  columns: usize,
  /// Blocks per row.
  stride: usize,
}

impl BitMatrix {
  pub fn new(rows: usize, columns: usize) -> Self {
    let stride = columns.div_ceil(BITS);
    BitMatrix {
      blocks: vec![0; rows * stride],
      rows,
      columns,
      stride,
    }
  }

  pub fn rows(&self) -> usize {
    self.rows
  }

  pub fn columns(&self) -> usize {
    self.columns
  }

  #[inline]
  pub fn row(&self, row: usize) -> &BitRow {
    let start = row * self.stride;
    BitRow::from_blocks(&self.blocks[start..start + self.stride])
  }

  #[inline]
  pub fn row_mut(&mut self, row: usize) -> &mut BitRow {
    let start = row * self.stride;
    BitRow::from_blocks_mut(&mut self.blocks[start..start + self.stride])
  }

  pub fn iter(&self) -> Rows<'_> {
    Rows {
      matrix: self,
      range: 0..self.rows,
    }
  }

  #[inline]
  pub fn contains(&self, row: usize, column: usize) -> bool {
    self.row(row).contains(column)
  }

  #[inline]
  pub fn insert(&mut self, row: usize, column: usize) {
    self.row_mut(row).insert(column);
  }

  #[inline]
  pub fn set(&mut self, row: usize, column: usize, enabled: bool) {
    self.row_mut(row).set(column, enabled);
  }

  /// Clear every row.
  pub fn clear(&mut self) {
    self.blocks.fill(0);
  }

  /// Keep only the first `rows` rows. The allocation is retained; call
  /// `shrink_to_fit` to release it.
  pub fn truncate(&mut self, rows: usize) {
    if rows < self.rows {
      self.blocks.truncate(rows * self.stride);
      self.rows = rows;
    }
  }

  /// Release capacity beyond the current rows.
  pub fn shrink_to_fit(&mut self) {
    self.blocks.shrink_to_fit();
  }

  /// Set every column of one row.
  pub fn fill_row(&mut self, row: usize) {
    let tail = self.columns % BITS;
    let blocks = self.row_mut(row).blocks_mut();
    blocks.fill(Block::MAX);
    if tail != 0 {
      if let Some(last) = blocks.last_mut() {
        *last = (1 << tail) - 1;
      }
    }
  }

  /// `dst |= src` between two rows of this matrix.
  pub fn union_rows(&mut self, dst: usize, src: usize) {
    if dst == src {
      return;
    }
    let (dst, src) = self.pair_mut(dst, src);
    dst.union_with(src);
  }

  /// Overwrite `dst` with `src`, both rows of this matrix.
  pub fn copy_row(&mut self, dst: usize, src: usize) {
    if dst == src {
      return;
    }
    let (dst, src) = self.pair_mut(dst, src);
    dst.copy_from(src);
  }

  fn pair_mut(&mut self, a: usize, b: usize) -> (&mut BitRow, &BitRow) {
    debug_assert_ne!(a, b);
    let stride = self.stride;
    let (a_start, b_start) = (a * stride, b * stride);
    if a < b {
      let (head, tail) = self.blocks.split_at_mut(b_start);
      (
        BitRow::from_blocks_mut(&mut head[a_start..a_start + stride]),
        BitRow::from_blocks(&tail[..stride]),
      )
    } else {
      let (head, tail) = self.blocks.split_at_mut(a_start);
      (
        BitRow::from_blocks_mut(&mut tail[..stride]),
        BitRow::from_blocks(&head[b_start..b_start + stride]),
      )
    }
  }
}

impl Index<usize> for BitMatrix {
  type Output = BitRow;

  #[inline]
  fn index(&self, row: usize) -> &BitRow {
    self.row(row)
  }
}

impl IndexMut<usize> for BitMatrix {
  #[inline]
  fn index_mut(&mut self, row: usize) -> &mut BitRow {
    self.row_mut(row)
  }
}

impl<'a> IntoIterator for &'a BitMatrix {
  type Item = &'a BitRow;
  type IntoIter = Rows<'a>;

  fn into_iter(self) -> Rows<'a> {
    self.iter()
  }
}

/// The rows of a matrix, in order.
pub struct Rows<'a> {
  matrix: &'a BitMatrix,
  range: std::ops::Range<usize>,
}

impl<'a> Iterator for Rows<'a> {
  type Item = &'a BitRow;

  fn next(&mut self) -> Option<&'a BitRow> {
    self.range.next().map(|row| self.matrix.row(row))
  }

  fn size_hint(&self) -> (usize, Option<usize>) {
    self.range.size_hint()
  }
}

impl ExactSizeIterator for Rows<'_> {}

impl<'a> DoubleEndedIterator for Rows<'a> {
  fn next_back(&mut self) -> Option<&'a BitRow> {
    self.range.next_back().map(|row| self.matrix.row(row))
  }
}

impl fmt::Debug for BitMatrix {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.debug_list().entries(self.iter()).finish()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn rows_are_independent_and_padded() {
    let mut m = BitMatrix::new(3, 70);
    m.insert(0, 0);
    m.insert(1, 69);
    m.insert(2, 64);
    assert!(m.contains(0, 0));
    assert!(!m.contains(0, 1));
    assert!(!m.contains(1, 0));
    assert!(m.contains(1, 69));
    assert_eq!(m[1].ones().collect::<Vec<_>>(), vec![69]);
    assert_eq!(m[2].count_ones(), 1);
    m.fill_row(0);
    assert_eq!(m[0].count_ones(), 70);
    assert_eq!(m[0].ones().last(), Some(69));
    m.clear();
    assert!(m.iter().all(BitRow::is_clear));
  }

  #[test]
  fn row_operations_between_rows_and_bitsets() {
    let mut m = BitMatrix::new(2, 100);
    m[0].insert(3);
    m[0].insert(90);
    m[1].insert(90);
    assert!(m[1].is_subset(&m[0]));
    assert!(!m[0].is_subset(&m[1]));
    assert!(!m[0].is_disjoint(&m[1]));
    assert_eq!(m[0].difference(&m[1]).collect::<Vec<_>>(), vec![3]);
    assert_eq!(m[0].intersection(&m[1]).collect::<Vec<_>>(), vec![90]);
    let mut both = FixedBitSet::with_capacity(100);
    both.insert(7);
    both.bits_mut().copy_union_from(&m[0], &m[1]);
    assert_eq!(both.ones().collect::<Vec<_>>(), vec![3, 90]);
    m.union_rows(1, 0);
    assert_eq!(m[0], m[1]);
    m[1].set(3, false);
    m.copy_row(0, 1);
    assert_eq!(m[0].ones().collect::<Vec<_>>(), vec![90]);

    let mut scratch = FixedBitSet::with_capacity(100);
    scratch.insert(5);
    scratch.bits_mut().union_with(&m[0]);
    assert_eq!(scratch.ones().collect::<Vec<_>>(), vec![5, 90]);
    assert!(m[0].is_subset(scratch.bits()));
    assert!(!scratch.bits().is_subset(&m[0]));
    assert_eq!(scratch.bits().intersection_count(&m[0]), 1);
    assert!(!m[0].intersect_changed(scratch.bits()));
    m[0].copy_from(scratch.bits());
    assert_eq!(m[0], *scratch.bits());
    scratch.set(90, false);
    assert!(m[0].intersect_changed(scratch.bits()));
    assert_eq!(m[0].ones().collect::<Vec<_>>(), vec![5]);
    let owned = m[0].to_owned();
    assert_eq!(*owned, m[0]);
  }

  // Row operations assume a `FixedBitSet` of the same width exposes the same
  // number of blocks as a matrix row. Pin that against the dependency.
  #[test]
  fn fixed_bitset_slices_match_row_block_counts() {
    for width in [0, 1, 63, 64, 65, 127, 128, 129, 1000] {
      let row = BitMatrix::new(1, width);
      let scratch = FixedBitSet::with_capacity(width);
      assert_eq!(
        scratch.as_slice().len(),
        row[0].blocks().len(),
        "width {width}"
      );
    }
  }

  #[test]
  fn rows_hash_and_compare_like_equal_width_bitsets() {
    use std::collections::HashSet;
    let mut m = BitMatrix::new(1, 10);
    m.insert(0, 4);
    let mut b = FixedBitSet::with_capacity(10);
    b.insert(4);
    assert_eq!(m[0], *b.bits());
    let mut set = HashSet::new();
    set.insert(m[0].to_owned());
    assert!(set.contains(b.bits()));
  }
}
