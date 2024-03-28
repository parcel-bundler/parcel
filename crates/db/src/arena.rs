use std::{cell::RefCell, thread::LocalKey};

use crate::page_allocator::{current_heap, pack_addr, unpack_addr};

thread_local! {
  pub static ARENA_ADDR: RefCell<u32> = const { RefCell::new(1) };
}

// TODO This struct can contain the pub fns once the thread_local feature becomes
// available in Rust stable
pub struct Arena {
  pub addr: &'static LocalKey<RefCell<u32>>,
}

impl Default for Arena {
  fn default() -> Self {
    Arena::new(&ARENA_ADDR)
  }
}

impl Arena {
  pub const fn new(addr: &'static LocalKey<RefCell<u32>>) -> Self {
    Self { addr }
  }
}

/// A trait for types that can be allocated in an arena.
pub trait ArenaAllocated: Sized {
  fn alloc_ptr() -> u32 {
    alloc_arena(std::mem::size_of::<Self>() as u32)
  }

  fn dealloc_ptr(addr: u32) {
    // Call destructors.
    unsafe {
      let ptr: *mut Self = current_heap().get(addr);
      std::ptr::drop_in_place(ptr);
    }

    dealloc_arena(addr, std::mem::size_of::<Self>() as u32);
  }

  fn into_arena(self) -> u32 {
    let addr = Self::alloc_ptr();
    let ptr = unsafe { current_heap().get(addr) };
    unsafe { std::ptr::write(ptr, self) };
    addr
  }

  fn extend_vec(_addr: u32, _count: u32) {
    unreachable!("Cannot call extend_vec for an ArenaAllocated type");
  }
}

pub fn alloc_arena(size: u32) -> u32 {
  let size = (size + 7) & !7;
  ARENA_ADDR.with_borrow_mut(|arena_addr| {
    let addr = *arena_addr;
    if addr == 1 {
      let page_index = current_heap().alloc_page(size as usize, false);
      if page_index == 0 {
        // Ensure the address is never zero.
        *arena_addr = pack_addr(page_index, size + 8);
        return pack_addr(page_index, 8);
      }
      *arena_addr = pack_addr(page_index, size);
      return pack_addr(page_index, 0);
    }

    let (page_index, offset) = unpack_addr(addr);
    let page = current_heap().get_page(page_index);
    if (offset + size) as usize >= page.len() {
      let page_index = current_heap().alloc_page(size as usize, false);
      *arena_addr = pack_addr(page_index, size);
      pack_addr(page_index, 0)
    } else {
      *arena_addr = addr + size;
      addr
    }
  })
}

pub fn dealloc_arena(addr: u32, size: u32) {
  ARENA_ADDR.with_borrow_mut(|arena_addr| {
    let a = *arena_addr;
    debug_assert!(a != 1);

    if a - size == addr {
      *arena_addr -= size;
    }
  });
}
