use std::{
  cell::UnsafeCell,
  sync::{
    atomic::{AtomicU32, Ordering},
    Mutex,
  },
};

const CHUNKS: usize = (u32::BITS + 1) as usize;

/// A ChunkList stores an indexed list of values.
/// Items are stored in chunks with lengths based on powers of two.
/// This means that for any given index, the location can be predicted
/// deterministically, and there are no reallocations.
struct ChunkList<T> {
  chunks: UnsafeCell<[*mut T; CHUNKS]>,
  lock: Mutex<()>,
}

unsafe impl<T> Sync for ChunkList<T> {}

impl<T> Default for ChunkList<T> {
  fn default() -> Self {
    ChunkList::new()
  }
}

impl<T> ChunkList<T> {
  const fn new() -> Self {
    Self {
      chunks: UnsafeCell::new([std::ptr::null_mut(); CHUNKS]),
      lock: Mutex::new(()),
    }
  }

  #[inline]
  fn chunk_location(&self, i: u32) -> (u32, u32) {
    let chunk = u32::BITS - i.leading_zeros();
    let chunk_length = self.chunk_length(chunk);
    let chunk_index = if i == 0 { 0 } else { i ^ chunk_length };
    (chunk, chunk_index)
  }

  #[inline]
  fn chunk_length(&self, chunk: u32) -> u32 {
    1 << chunk.saturating_sub(1)
  }

  fn chunk_data_mut(&self, chunk_index: u32) -> &mut [T] {
    let chunk_length = self.chunk_length(chunk_index) as usize;
    let chunks = unsafe { &mut *self.chunks.get() };
    let mut data = chunks[chunk_index as usize];
    if data.is_null() {
      let guard = self.lock.lock().unwrap();
      // Now that we acquired the lock, check again in case another thread allocated while we were waiting.
      data = chunks[chunk_index as usize];
      if data.is_null() {
        let layout = std::alloc::Layout::array::<T>(chunk_length).unwrap();
        data = unsafe { std::alloc::alloc(layout).cast::<T>() };
        chunks[chunk_index as usize] = data;
      }
      drop(guard);
    }

    unsafe { std::slice::from_raw_parts_mut(data, chunk_length) }
  }

  fn chunk_data(&self, chunk_index: u32) -> Option<&[T]> {
    let chunk_length = self.chunk_length(chunk_index) as usize;
    let chunks = unsafe { &*self.chunks.get() };
    let data = chunks[chunk_index as usize];
    if data.is_null() {
      None
    } else {
      Some(unsafe { std::slice::from_raw_parts_mut(data, chunk_length) })
    }
  }

  unsafe fn chunk_data_unchecked(&self, chunk_index: u32) -> &[T] {
    let chunk_length = self.chunk_length(chunk_index) as usize;
    let chunks = unsafe { &*self.chunks.get() };
    let data = chunks[chunk_index as usize];
    unsafe { std::slice::from_raw_parts_mut(data, chunk_length) }
  }

  fn get(&self, i: u32) -> Option<&T> {
    let (chunk, chunk_index) = self.chunk_location(i);
    self
      .chunk_data(chunk)
      .and_then(|chunk| chunk.get(chunk_index as usize))
  }

  unsafe fn get_unchecked(&self, i: u32) -> &T {
    let (chunk, chunk_index) = self.chunk_location(i);
    self
      .chunk_data_unchecked(chunk)
      .get_unchecked(chunk_index as usize)
  }

  // fn get_ensure(&self, i: usize) -> &T {
  //   let (chunk, chunk_index) = self.chunk_location(i);
  //   &self.chunk_data_mut(chunk)[chunk_index]
  // }

  // /// This is unsafe unless you are sure that no one else is accessing the index.
  // unsafe fn get_mut(&self, i: usize) -> &mut T {
  //   let (chunk, chunk_index) = self.chunk_location(i);
  //   &mut self.chunk_data_mut(chunk)[chunk_index]
  // }

  /// This is unsafe unless you are sure that no one else is accessing the index.
  unsafe fn set(&self, i: u32, v: T) {
    let (chunk, chunk_index) = self.chunk_location(i);
    let chunk = self.chunk_data_mut(chunk);
    unsafe { std::ptr::write(chunk.as_mut_ptr().add(chunk_index as usize), v) };
  }
}

impl<T> Drop for ChunkList<T> {
  fn drop(&mut self) {
    let chunks = unsafe { &*self.chunks.get() };
    for chunk_index in 0..chunks.len() {
      let data = chunks[chunk_index];
      if !data.is_null() {
        let chunk_length = self.chunk_length(chunk_index as u32) as usize;
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

/// An AtomicVec is a vector that stores items atomically, with no locks.
/// Items may only be pushed
pub struct AtomicVec<T> {
  list: ChunkList<T>,
  reserved: AtomicU32,
  len: AtomicU32,
}

impl<T> Default for AtomicVec<T> {
  fn default() -> Self {
    AtomicVec::new()
  }
}

impl<T> AtomicVec<T> {
  pub const fn new() -> Self {
    AtomicVec {
      list: ChunkList::new(),
      reserved: AtomicU32::new(0),
      len: AtomicU32::new(0),
    }
  }

  pub fn push(&self, v: T) -> u32 {
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

  pub fn get(&self, index: u32) -> Option<&T> {
    let len = self.len.load(Ordering::SeqCst);
    if index < len {
      self.list.get(index)
    } else {
      None
    }
  }

  pub unsafe fn get_unchecked(&self, index: u32) -> &T {
    self.list.get_unchecked(index)
  }

  /// This is unsafe unless you are sure no one else is accessing the index.
  // pub unsafe fn get_mut(&self, index: usize) -> Option<&mut T> {
  //   let len = self.len.load(Ordering::SeqCst);
  //   if index < len {
  //     Some(self.list.get_mut(index))
  //   } else {
  //     None
  //   }
  // }

  pub fn len(&self) -> u32 {
    self.len.load(Ordering::SeqCst)
  }
}
