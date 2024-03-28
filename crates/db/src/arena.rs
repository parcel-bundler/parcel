use std::cell::RefCell;

use crate::page_allocator::{current_heap, pack_addr, unpack_addr};

thread_local! {
  pub static ARENA: RefCell<Option<&'static mut Arena>> = const { RefCell::new(None) };
}

pub struct Arena {
  pub addr: u32,
}

impl Default for Arena {
  fn default() -> Self {
    Arena::new()
  }
}

impl Arena {
  pub const fn new() -> Self {
    Self { addr: 1 }
  }

  pub fn alloc(&mut self, size: u32) -> u32 {
    let size = (size + 7) & !7;
    let addr = self.addr;
    if addr == 1 {
      let page_index = current_heap().alloc_page(size as usize, false);
      if page_index == 0 {
        // Ensure the address is never zero.
        self.addr = pack_addr(page_index, size + 8);
        return pack_addr(page_index, 8);
      }
      self.addr = pack_addr(page_index, size);
      return pack_addr(page_index, 0);
    }

    let (page_index, offset) = unpack_addr(addr);
    let page = current_heap().get_page(page_index);
    if (offset + size) as usize >= page.len() {
      let page_index = current_heap().alloc_page(size as usize, false);
      self.addr = pack_addr(page_index, size);
      pack_addr(page_index, 0)
    } else {
      self.addr += size;
      addr
    }
  }

  pub fn dealloc(&mut self, addr: u32, size: u32) {
    debug_assert!(self.addr != 1);

    if self.addr - size == addr {
      self.addr -= size;
    }
  }
}

/// A trait for types that can be allocated in an arena.
pub trait ArenaAllocated: Sized {
  fn alloc_ptr() -> u32 {
    unsafe {
      ARENA.with_borrow_mut(|arena| {
        arena
          .as_mut()
          .unwrap_unchecked()
          .alloc(std::mem::size_of::<Self>() as u32)
      })
    }
  }

  fn dealloc_ptr(addr: u32) {
    // Call destructors.
    unsafe {
      let ptr: *mut Self = current_heap().get(addr);
      std::ptr::drop_in_place(ptr);

      ARENA.with_borrow_mut(|arena| {
        arena
          .as_mut()
          .unwrap_unchecked()
          .dealloc(addr, std::mem::size_of::<Self>() as u32)
      })
    }
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
