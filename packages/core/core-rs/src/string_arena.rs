use crate::atomics::AtomicVec;
use dashmap::DashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

// https://matklad.github.io/2020/03/22/fast-simple-rust-interner.html
pub struct StringArena {
  map: DashMap<&'static str, u32>,
  vec: AtomicVec<&'static str>,
  full: AtomicVec<AtomicBuffer>,
}

impl Default for StringArena {
  fn default() -> Self {
    StringArena::new()
  }
}

impl StringArena {
  pub fn new() -> Self {
    let full = AtomicVec::new();
    full.push(AtomicBuffer::default());
    Self {
      map: DashMap::default(),
      vec: AtomicVec::new(),
      full,
    }
  }

  pub fn intern(&self, name: &str) -> u32 {
    if let Some(id) = self.map.get(name) {
      return *id;
    }
    let name = unsafe { self.alloc(name) };
    let id = self.vec.push(name) as u32;
    self.map.insert(name, id);

    // assert!(self.lookup(id) == name);
    // assert!(self.intern(name) == id);

    id
  }

  pub fn lookup(&self, id: u32) -> &'static str {
    self.vec.get(id as usize).unwrap()
  }

  unsafe fn alloc(&self, name: &str) -> &'static str {
    loop {
      // Try to push the string into the last buffer in the list.
      let buf = self.full.get(self.full.len() - 1).unwrap();
      match buf.push(name.as_bytes()) {
        Ok(interned) => {
          let res = std::str::from_utf8_unchecked(interned);
          return &*(res as *const str);
        }
        Err(()) => {
          // If that failed, there wasn't enough capacity, so allocate
          // a new buffer and push it to the list. Then, try again.
          // TODO: lock here to prevent duplicate allocations?
          let new_cap = (buf.cap.max(name.len()) + 1).next_power_of_two();
          let new_buf = AtomicBuffer::with_capacity(new_cap);
          self.full.push(new_buf);
        }
      }
    }
  }
}

struct AtomicBuffer {
  buf: *mut u8,
  reserved: AtomicUsize,
  cap: usize,
}

impl Default for AtomicBuffer {
  fn default() -> Self {
    Self::with_capacity(1024)
  }
}

impl AtomicBuffer {
  fn with_capacity(cap: usize) -> Self {
    let layout = std::alloc::Layout::array::<u8>(cap).unwrap();
    let ptr = unsafe { std::alloc::alloc(layout).cast::<u8>() };
    Self {
      buf: ptr,
      reserved: AtomicUsize::new(0),
      cap,
    }
  }

  fn push(&self, bytes: &[u8]) -> Result<&[u8], ()> {
    // Try to reserve the required number of bytes.
    let offset = self.reserved.fetch_add(bytes.len(), Ordering::SeqCst);
    if offset + bytes.len() >= self.cap {
      return Err(());
    }

    // Copy the data into the buffer.
    unsafe { std::ptr::copy(bytes.as_ptr(), self.buf.add(offset), bytes.len()) };

    // Return a slice of the copied data.
    let slice = unsafe { std::slice::from_raw_parts(self.buf.add(offset), bytes.len()) };
    Ok(slice)
  }
}

impl Drop for AtomicBuffer {
  fn drop(&mut self) {
    if !self.buf.is_null() {
      let layout = std::alloc::Layout::array::<u8>(self.cap).unwrap();
      unsafe { std::alloc::dealloc(self.buf, layout) };
      self.buf = std::ptr::null_mut();
    }
  }
}
