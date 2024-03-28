use std::{marker::PhantomData, ptr::NonNull};

use allocator_api2::alloc::Allocator;

use crate::{
  arena::{ArenaAllocated, ARENA},
  page_allocator::current_heap,
  ArenaVec,
};

pub struct Slab<T> {
  free_head: u32,
  phantom: PhantomData<T>,
}

impl<T> Default for Slab<T> {
  fn default() -> Self {
    Slab::new()
  }
}

#[derive(Debug)]
struct FreeNode {
  slots: u32,
  next: u32,
}

impl<T> Slab<T> {
  pub const fn new() -> Self {
    Slab {
      free_head: 1,
      phantom: PhantomData,
    }
  }

  pub fn alloc(&mut self, count: u32) -> u32 {
    let size = std::mem::size_of::<T>().max(std::mem::size_of::<FreeNode>()) as u32;
    if self.free_head != 1 {
      let mut addr = self.free_head;
      let mut prev = &mut self.free_head;
      loop {
        let node = unsafe { &mut *current_heap().get::<FreeNode>(addr) };
        if node.slots >= count {
          if count < node.slots {
            node.slots -= count;
            addr += size * node.slots;
          } else {
            *prev = node.next;
          }
          // println!(
          //   "REUSED {:?} {} {} {:?}",
          //   unpack_addr(addr),
          //   count,
          //   node.slots,
          //   unpack_addr(node.next)
          // );
          // self.debug_free_list();
          return addr;
        }
        if node.next == 1 {
          break;
        }
        addr = node.next;
        prev = &mut node.next;
      }
    }

    unsafe { ARENA.with_borrow_mut(|arena| arena.as_mut().unwrap_unchecked().alloc(size * count)) }
  }

  pub fn dealloc(&mut self, addr: u32, count: u32) {
    // println!("DEALLOC {} {}", std::any::type_name::<Self>(), count);

    // let size = std::mem::size_of::<T>() as u32;
    // if self.free_head != 1 {
    //   let node = &mut *HEAP.get::<FreeNode>(self.free_head);
    //   if addr + size * count == self.free_head {
    //     count += node.slots;
    //     self.free_head = node.next;
    //   } else if self.free_head + size * node.slots == addr {
    //     node.slots += count;
    //     return;
    //   }
    // }

    let node = unsafe { &mut *current_heap().get::<FreeNode>(addr) };
    node.slots = count;
    node.next = self.free_head;
    self.free_head = addr;
    // self.debug_free_list();
  }

  fn debug_free_list(&self) {
    let mut addr = self.free_head;
    let mut free = 0;
    while addr != 1 {
      let node = unsafe { &*current_heap().get::<FreeNode>(addr) };
      println!("{} {:?}", addr, node);
      free += node.slots;
      addr = node.next;
    }
    println!("FREE SLOTS: {}", free);
  }
}

// Automatically implement ArenaAllocated for SlabAllocated types.
impl<T: SlabAllocated + Sized> ArenaAllocated for T {
  fn alloc_ptr() -> u32 {
    T::alloc(1).0
  }

  fn dealloc_ptr(addr: u32) {
    // Call destructors.
    unsafe {
      let ptr: *mut Self = current_heap().get(addr);
      std::ptr::drop_in_place(ptr);
    }

    T::dealloc(addr, 1)
  }

  fn extend_vec(addr: u32, count: u32) {
    let vec: &mut ArenaVec<Self> = unsafe { &mut *current_heap().get(addr) };
    vec.reserve(count as usize);
  }
}

/// A trait for types that can be allocated in a type-specific slab.
pub trait SlabAllocated {
  fn alloc(count: u32) -> (u32, *mut Self);
  fn dealloc(addr: u32, count: u32);
}

/// An allocator that uses a slab.
#[derive(Clone)]
pub struct SlabAllocator<T> {
  phantom: PhantomData<T>,
}

impl<T> SlabAllocator<T> {
  pub fn new() -> Self {
    Self {
      phantom: PhantomData,
    }
  }
}

unsafe impl<T: SlabAllocated> Allocator for SlabAllocator<T> {
  fn allocate(
    &self,
    layout: std::alloc::Layout,
  ) -> Result<std::ptr::NonNull<[u8]>, allocator_api2::alloc::AllocError> {
    let size = std::mem::size_of::<T>();
    let count = layout.size() / size;
    let (_, ptr) = T::alloc(count as u32);
    unsafe {
      Ok(NonNull::new_unchecked(core::slice::from_raw_parts_mut(
        ptr as *mut u8,
        size,
      )))
    }
  }

  unsafe fn deallocate(&self, ptr: std::ptr::NonNull<u8>, layout: std::alloc::Layout) {
    let size = std::mem::size_of::<T>();
    let count = layout.size() / size;
    let addr = current_heap().find_page(ptr.as_ptr()).unwrap();
    T::dealloc(addr, count as u32);
  }
}

#[cfg(test)]
mod test {
  use super::*;

  #[test]
  fn test_slab() {
    struct Test {
      foo: u32,
      bar: u32,
    }

    let mut slab = Slab::<Test>::new();
    let addr1 = slab.alloc(5);
    assert_eq!(addr1, 0);
    let addr2 = slab.alloc(2);
    assert_eq!(addr2, 40);
    slab.dealloc(addr1, 5);
    let addr = slab.alloc(1);
    assert_eq!(addr, 32);
    slab.dealloc(addr2, 2);
    let addr = slab.alloc(4);
    assert_eq!(addr, 0);
    slab.debug_free_list();
    // let addr = slab.alloc(2);
    // assert_eq!(addr, 24);
    // let addr = slab.alloc(2);
    // assert_eq!(addr, 24);
  }
}
