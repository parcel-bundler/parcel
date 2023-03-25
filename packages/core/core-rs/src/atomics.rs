use std::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};

const CHUNKS: usize = (usize::BITS + 1) as usize;

/// An AtomicList stores an indexed list of values.
/// Items are stored in chunks with lengths based on powers of two.
/// This means that for any given index, the location can be predicted
/// deterministically, and there are no reallocations. Chunk pointers
/// are allocated and stored atomically, but individual items within
/// chunks are *not* atomic. Typically this struct should not be used
/// directly, but via a higher level data structure such as AtomicVec.
struct AtomicList<T> {
  chunks: [AtomicPtr<T>; CHUNKS],
}

impl<T> Default for AtomicList<T> {
  fn default() -> Self {
    AtomicList::new()
  }
}

impl<T> AtomicList<T> {
  fn new() -> Self {
    Self {
      chunks: [std::ptr::null_mut(); CHUNKS].map(|p| AtomicPtr::new(p)),
    }
  }

  #[inline]
  fn chunk_location(&self, i: usize) -> (usize, usize) {
    let chunk = (usize::BITS - i.leading_zeros()) as usize;
    let chunk_length = self.chunk_length(chunk);
    let chunk_index = if i == 0 { 0 } else { i ^ chunk_length };
    (chunk, chunk_index)
  }

  #[inline]
  fn chunk_length(&self, chunk: usize) -> usize {
    1 << chunk.saturating_sub(1)
  }

  fn chunk_data_mut(&self, chunk_index: usize) -> &mut [T] {
    let chunk_length = self.chunk_length(chunk_index);
    let mut data = self.chunks[chunk_index].load(Ordering::Acquire);
    if data.is_null() {
      let layout = std::alloc::Layout::array::<T>(chunk_length).unwrap();
      let ptr = unsafe { std::alloc::alloc_zeroed(layout).cast::<T>() };
      let res =
        self.chunks[chunk_index].compare_and_swap(std::ptr::null_mut(), ptr, Ordering::Release);
      if !res.is_null() {
        // Someone else allocated at the same time. Take theirs.
        unsafe { std::alloc::dealloc(ptr.cast(), layout) };
        data = res;
      } else {
        data = ptr;
      }
    }

    unsafe { std::slice::from_raw_parts_mut(data, chunk_length) }
  }

  fn chunk_data(&self, chunk_index: usize) -> Option<&[T]> {
    let chunk_length = self.chunk_length(chunk_index);
    let data = self.chunks[chunk_index].load(Ordering::Acquire);
    if data.is_null() {
      None
    } else {
      Some(unsafe { std::slice::from_raw_parts_mut(data, chunk_length) })
    }
  }

  fn get(&self, i: usize) -> Option<&T> {
    let (chunk, chunk_index) = self.chunk_location(i);
    self
      .chunk_data(chunk)
      .and_then(|chunk| chunk.get(chunk_index))
  }

  fn get_ensure(&self, i: usize) -> &T {
    let (chunk, chunk_index) = self.chunk_location(i);
    &self.chunk_data_mut(chunk)[chunk_index]
  }

  /// This is unsafe unless you are sure that no one else is accessing the index.
  unsafe fn get_mut(&self, i: usize) -> &mut T {
    let (chunk, chunk_index) = self.chunk_location(i);
    &mut self.chunk_data_mut(chunk)[chunk_index]
  }

  /// This is unsafe unless you are sure that no one else is accessing the index.
  unsafe fn set(&self, i: usize, v: T) {
    let (chunk, chunk_index) = self.chunk_location(i);
    let chunk = self.chunk_data_mut(chunk);
    unsafe { std::ptr::write(chunk.as_mut_ptr().add(chunk_index), v) };
  }
}

impl<T> Drop for AtomicList<T> {
  fn drop(&mut self) {
    for chunk_index in 0..self.chunks.len() {
      let chunk_length = self.chunk_length(chunk_index);
      let data = self.chunks[chunk_index].swap(std::ptr::null_mut(), Ordering::Acquire);
      if !data.is_null() {
        let slice = unsafe { std::slice::from_raw_parts(data, chunk_length) };
        for v in slice {
          drop(v);
        }
        let layout = std::alloc::Layout::array::<T>(chunk_length).unwrap();
        unsafe { std::alloc::dealloc(data.cast(), layout) };
      }
    }
  }
}

/// An AtomicBitSet is a bit set that can be read and updated atomically, with no locks.
pub struct AtomicBitSet {
  data: AtomicList<AtomicUsize>,
}

impl AtomicBitSet {
  pub fn new() -> Self {
    Self {
      data: AtomicList::new(),
    }
  }

  pub fn insert(&self, bit: usize) -> bool {
    let i = bit / (usize::BITS as usize);
    let b = bit % (usize::BITS as usize);
    self.data.get_ensure(i).fetch_or(1 << b, Ordering::Relaxed) & (1 << b) == 0
  }

  pub fn contains(&self, bit: usize) -> bool {
    let i = bit / (usize::BITS as usize);
    let b = bit % (usize::BITS as usize);
    if let Some(v) = self.data.get(i) {
      v.load(Ordering::Relaxed) & (1 << b) != 0
    } else {
      false
    }
  }

  pub fn remove(&self, bit: usize) {
    let i = bit / (usize::BITS as usize);
    let b = bit % (usize::BITS as usize);
    if let Some(c) = self.data.get(i) {
      c.fetch_and(!(1 << b), Ordering::Relaxed);
    }
  }
}

/// An AtomicVec is a vector that stores items atomically, with no locks.
/// Items may only be pushed
pub struct AtomicVec<T> {
  list: AtomicList<T>,
  reserved: AtomicUsize,
  len: AtomicUsize,
}

impl<T> Default for AtomicVec<T> {
  fn default() -> Self {
    AtomicVec::new()
  }
}

impl<T> AtomicVec<T> {
  pub fn new() -> Self {
    AtomicVec {
      list: AtomicList::new(),
      reserved: AtomicUsize::new(0),
      len: AtomicUsize::new(0),
    }
  }

  pub fn push(&self, v: T) -> usize {
    // First, reserve space for the new item.
    let idx = self.reserved.fetch_add(1, Ordering::SeqCst);
    unsafe { self.list.set(idx, v) };

    // After writing the value, increase the length so it is readable.
    // If this fails, someone else started writing before us, so we need
    // to wait for them to finish before updating the count.
    while self
      .len
      .compare_exchange(idx, idx + 1, Ordering::Release, Ordering::Relaxed)
      .is_err()
    {
      std::hint::spin_loop();
    }

    idx
  }

  pub fn get(&self, index: usize) -> Option<&T> {
    let len = self.len.load(Ordering::SeqCst);
    if index < len {
      self.list.get(index)
    } else {
      None
    }
  }

  /// This is unsafe unless you are sure no one else is accessing the index.
  pub unsafe fn get_mut(&self, index: usize) -> Option<&mut T> {
    let len = self.len.load(Ordering::SeqCst);
    if index < len {
      Some(self.list.get_mut(index))
    } else {
      None
    }
  }

  pub fn len(&self) -> usize {
    self.len.load(Ordering::SeqCst)
  }
}

#[cfg(test)]
mod tests {
  use super::AtomicBitSet;

  #[test]
  fn test_bitset() {
    let set = AtomicBitSet::new();
    set.insert(10);
    set.insert(5);
    set.insert(100);
    set.insert(5298);

    assert!(set.contains(10));
    assert!(set.contains(5));
    assert!(set.contains(100));
    assert!(set.contains(5298));
    assert!(!set.contains(50));
    assert!(!set.contains(1));
  }
}
