use allocator_api2::vec::Vec;
use std::{hash::Hash, marker::PhantomData};

use crate::{
  codegen::{JsValue, ToJs},
  page_allocator::current_heap,
  slab::{SlabAllocated, SlabAllocator},
};

/// A Vec that allocates in the ParcelDB arena.
pub struct ArenaVec<T: SlabAllocated> {
  buf: u32,
  len: u32,
  cap: u32,
  phantom: PhantomData<T>,
}

impl<T: SlabAllocated + Clone> Clone for ArenaVec<T> {
  fn clone(&self) -> Self {
    let vec = unsafe { self.as_vec() };
    let mut res = Self::new();
    unsafe {
      res.update(vec.clone());
    }
    std::mem::forget(vec);
    res
  }
}

impl<T: PartialEq + SlabAllocated> PartialEq for ArenaVec<T> {
  fn eq(&self, other: &Self) -> bool {
    self.as_slice().eq(other.as_slice())
  }
}

impl<T: SlabAllocated> Drop for ArenaVec<T> {
  fn drop(&mut self) {
    drop(unsafe { self.as_vec() })
  }
}

impl<T: SlabAllocated> ArenaVec<T> {
  pub fn new() -> Self {
    Self {
      buf: 0,
      len: 0,
      cap: 0,
      phantom: PhantomData,
    }
  }

  unsafe fn as_vec(&self) -> Vec<T, SlabAllocator<T>> {
    let ptr = current_heap().get(self.buf);
    Vec::from_raw_parts_in(
      ptr,
      self.len as usize,
      self.cap as usize,
      SlabAllocator::new(),
    )
  }

  unsafe fn update(&mut self, vec: Vec<T, SlabAllocator<T>>) {
    self.buf = if vec.capacity() == 0 {
      0
    } else {
      current_heap().find_page(vec.as_ptr() as *const u8).unwrap()
    };
    self.len = vec.len() as u32;
    self.cap = vec.capacity() as u32;
    std::mem::forget(vec)
  }

  pub fn push(&mut self, value: T) {
    unsafe {
      let mut vec = self.as_vec();
      vec.push(value);
      self.update(vec);
    }
  }

  pub fn as_slice(&self) -> &[T] {
    unsafe {
      let ptr = current_heap().get(self.buf);
      std::slice::from_raw_parts(ptr, self.len as usize)
    }
  }

  pub fn reserve(&mut self, count: usize) {
    unsafe {
      let mut vec = self.as_vec();
      vec.reserve(count);
      self.update(vec)
    }
  }

  pub fn len(&self) -> u32 {
    self.len
  }

  pub fn is_empty(&self) -> bool {
    self.len == 0
  }
}

impl<T: std::fmt::Debug + SlabAllocated + Clone> std::fmt::Debug for ArenaVec<T> {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.as_slice().fmt(f)
  }
}

impl<T: SlabAllocated> Default for ArenaVec<T> {
  fn default() -> Self {
    Self::new()
  }
}

impl<T: SlabAllocated + Hash> Hash for ArenaVec<T> {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    self.as_slice().hash(state)
  }
}

impl<T: JsValue + SlabAllocated> JsValue for ArenaVec<T> {
  fn js_getter(db: &str, addr: &str, offset: usize) -> String {
    let size = std::mem::size_of::<T>();
    let ty = <T>::accessor();
    format!(
      "new Vec({db}, {addr} + {offset}, {size}, {ty})",
      db = db,
      addr = addr,
      offset = offset,
      size = size,
      ty = ty
    )
  }

  fn js_setter(db: &str, addr: &str, offset: usize, value: &str) -> String {
    let size = std::mem::size_of::<ArenaVec<T>>();
    format!(
      "copy({db}, {value}.addr, {addr} + {offset}, {size});",
      db = db,
      addr = addr,
      offset = offset,
      size = size,
      value = value
    )
  }

  fn ty() -> String {
    format!("Vec<{}>", <T>::ty())
  }
}

impl<T: SlabAllocated> ToJs for ArenaVec<T> {
  fn to_js() -> String {
    let c = std::mem::MaybeUninit::uninit();
    let p: *const ArenaVec<T> = c.as_ptr();
    let u8_ptr = p as *const u8;
    let buf_offset =
      unsafe { (std::ptr::addr_of!((*p).buf) as *const u8).offset_from(u8_ptr) as usize };
    let len_offset =
      unsafe { (std::ptr::addr_of!((*p).len) as *const u8).offset_from(u8_ptr) as usize };
    let cap_offset =
      unsafe { (std::ptr::addr_of!((*p).cap) as *const u8).offset_from(u8_ptr) as usize };

    format!(
      r#"interface TypeAccessor<T> {{
  typeId: number;
  get(db: ParcelDb, addr: number): T,
  set(db: ParcelDb, addr: number, value: T): void
}}
      
class Vec<T> {{
  db: ParcelDb;
  addr: number;
  size: number;
  accessor: TypeAccessor<T>;
  /*::
  @@iterator(): Iterator<T> {{ return ({{}}: any); }}
  */

  constructor(db: ParcelDb, addr: number, size: number, accessor: TypeAccessor<T>) {{
    this.db = db;
    this.addr = addr;
    this.size = size;
    this.accessor = accessor;
  }}

  get length(): number {{
    return readU32(this.db, this.addr + {len_offset});
  }}

  get capacity(): number {{
    return readU32(this.db, this.addr + {cap_offset});
  }}

  get(index: number): T {{
    let bufAddr = readU32(this.db, this.addr + {buf_offset});
    return this.accessor.get(this.db, bufAddr + index * this.size);
  }}

  set(index: number, value: T): void {{
    if (index >= this.length) {{
      throw new Error(`Index out of bounds: ${{index}} >= ${{this.length}}`);
    }}
    let bufAddr = readU32(this.db, this.addr + {buf_offset});
    this.accessor.set(this.db, bufAddr + index * this.size, value);
  }}

  reserve(count: number): void {{
    if (this.length + count > this.capacity) {{
      this.db.extendVec(this.accessor.typeId, this.addr, count);
    }}
  }}

  push(value: T): void {{
    this.reserve(1);
    writeU32(this.db, this.addr + {len_offset}, readU32(this.db, this.addr + {len_offset}) + 1);
    this.set(this.length - 1, value);
  }}

  extend(): T {{
    this.reserve(1);
    writeU32(this.db, this.addr + {len_offset}, readU32(this.db, this.addr + {len_offset}) + 1);
    return this.get(this.length - 1);
  }}

  delete(index: number): void {{
    let bufAddr = readU32(this.db, this.addr + {buf_offset});
    let fromAddr = bufAddr + (index + 1) * this.size;
    let toAddr = bufAddr + index * this.size;
    copy(this.db, fromAddr, toAddr, (this.length - index + 1) * this.size);
    writeU32(this.db, this.addr + {len_offset}, readU32(this.db, this.addr + {len_offset}) - 1);
  }}

  clear(): void {{
    // TODO: run Rust destructors?
    writeU32(this.db, this.addr + {len_offset}, 0);
  }}

  init(): void {{
    writeU32(this.db, this.addr + {len_offset}, 0);
    writeU32(this.db, this.addr + {cap_offset}, 0);
    writeU32(this.db, this.addr + {buf_offset}, 0);
  }}

  copyFrom(from: Vec<T>): void {{
    this.clear();
    this.reserve(from.length);
    let fromAddr = readU32(this.db, from.addr + {buf_offset});
    let toAddr = readU32(this.db, this.addr + {buf_offset});
    copy(this.db, fromAddr, toAddr, from.length * this.size);
    writeU32(this.db, this.addr + {len_offset}, from.length);
  }}

  // $FlowFixMe
  *[globalThis.Symbol.iterator]() {{
    let addr = readU32(this.db, this.addr + {buf_offset});
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {{
      yield this.accessor.get(this.db, addr);
    }}
  }}

  find(pred: (value: T) => mixed): ?T {{
    let addr = readU32(this.db, this.addr + {buf_offset});
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {{
      let value = this.accessor.get(this.db, addr);
      if (pred(value)) {{
        return value;
      }}
    }}
  }}

  findIndex(pred: (value: T) => mixed): number {{
    let addr = readU32(this.db, this.addr + {buf_offset});
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {{
      let value = this.accessor.get(this.db, addr);
      if (pred(value)) {{
        return i;
      }}
    }}
    return -1;
  }}

  some(pred: (value: T) => mixed): boolean {{
    let addr = readU32(this.db, this.addr + {buf_offset});
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {{
      let value = this.accessor.get(this.db, addr);
      if (pred(value)) {{
        return true;
      }}
    }}
    return false;
  }}

  every(pred: (value: T) => mixed): boolean {{
    let addr = readU32(this.db, this.addr + {buf_offset});
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {{
      let value = this.accessor.get(this.db, addr);
      if (!pred(value)) {{
        return false;
      }}
    }}
    return true;
  }}
}}
    "#,
      buf_offset = buf_offset,
      cap_offset = cap_offset,
      len_offset = len_offset
    )
  }
}
