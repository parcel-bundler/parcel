use std::{marker::PhantomData, ptr::NonNull};

use allocator_api2::alloc::{Allocator, Layout};

use crate::{atomics::AtomicVec, ArenaVec};

const PAGE_SIZE: usize = 65536;
const PTR_MAX: u32 = u32::MAX;
const NUM_PAGES: u32 = PTR_MAX / (PAGE_SIZE as u32) + 1;
const PAGE_INDEX_SIZE: u32 = NUM_PAGES.ilog2();
const PAGE_INDEX_SHIFT: u32 = 32 - PAGE_INDEX_SIZE;
const PAGE_INDEX_MASK: u32 = ((1 << PAGE_INDEX_SIZE) - 1) << PAGE_INDEX_SHIFT;
const PAGE_OFFSET_MASK: u32 = (1 << PAGE_INDEX_SHIFT) - 1;

#[inline]
fn unpack_addr(addr: u32) -> (u32, u32) {
  let page_index = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  (page_index, offset)
}

#[inline]
fn pack_addr(page: u32, offset: u32) -> u32 {
  (page << PAGE_INDEX_SHIFT) | (offset & PAGE_OFFSET_MASK)
}

pub struct PageAllocator {
  pages: AtomicVec<Page>,
}

unsafe impl Send for PageAllocator {}

struct Page {
  ptr: *mut u8,
  len: usize,
}

impl Drop for Page {
  fn drop(&mut self) {
    // println!("DROP PAGE");
    let layout = unsafe { Layout::from_size_align_unchecked(self.len, 8) };
    unsafe { std::alloc::dealloc(self.ptr.cast(), layout) };
  }
}

impl PageAllocator {
  pub fn new() -> Self {
    Self {
      pages: AtomicVec::new(),
    }
  }

  fn alloc_page(&self, min_size: usize, zeroed: bool) -> u32 {
    let len = min_size.max(PAGE_SIZE);
    // SAFETY: alignment is always 8, and size is always non-zero.
    let ptr = unsafe {
      let layout = Layout::from_size_align_unchecked(len, 8);

      if zeroed {
        std::alloc::alloc_zeroed(layout)
      } else {
        std::alloc::alloc(layout)
      }
    };

    // println!("ALLOC PAGE {:?}", self.pages.len());
    self.pages.push(Page { ptr, len })
  }

  pub unsafe fn get<T>(&self, addr: u32) -> *mut T {
    let (page_index, offset) = unpack_addr(addr);
    let ptr = self
      .pages
      .get_unchecked(page_index)
      .ptr
      .add(offset as usize);
    ptr as *mut T
  }

  pub fn get_page(&self, index: u32) -> &mut [u8] {
    let page = &self.pages.get(index).expect("invalid page");
    unsafe { core::slice::from_raw_parts_mut(page.ptr, page.len) }
  }

  pub fn find_page(&self, ptr: *const u8) -> Option<u32> {
    for i in 0..self.pages.len() {
      let page = self.get_page(i);
      if page.as_ptr_range().contains(&ptr) {
        return Some(pack_addr(i, (ptr as usize - page.as_ptr() as usize) as u32));
      }
    }

    None
  }

  pub fn write<W: std::io::Write>(&self, dest: &mut W) -> std::io::Result<()> {
    dest.write(&u32::to_le_bytes(self.pages.len()))?;
    for i in 0..self.pages.len() {
      let page = unsafe { self.pages.get_unchecked(i) };
      dest.write(&u32::to_le_bytes(page.len as u32))?;
      dest.write(unsafe { core::slice::from_raw_parts(page.ptr, page.len) })?;
    }
    Ok(())
  }

  pub fn read<R: std::io::Read>(source: &mut R) -> std::io::Result<PageAllocator> {
    let mut buf: [u8; 4] = [0; 4];
    source.read_exact(&mut buf)?;
    let len = u32::from_le_bytes(buf);
    let res = PageAllocator::new();
    for i in 0..len {
      source.read_exact(&mut buf)?;
      let len = u32::from_le_bytes(buf);
      res.alloc_page(len as usize, false);
      let page = res.get_page(i);
      source.read_exact(page)?;
    }
    Ok(res)
  }
}

pub struct Arena {
  addr: u32,
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
      println!("DEALLOC AT END");
      self.addr -= size;
    }
  }
}

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

    current_arena().alloc(size * count)
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

/// A trait for types that can be allocated in an arena.
pub trait ArenaAllocated: Sized {
  fn alloc_ptr() -> u32 {
    current_arena().alloc(std::mem::size_of::<Self>() as u32)
  }

  fn dealloc_ptr(addr: u32) {
    // Call destructors.
    unsafe {
      let ptr: *mut Self = current_heap().get(addr);
      std::ptr::drop_in_place(ptr);
    }

    current_arena().dealloc(addr, std::mem::size_of::<Self>() as u32);
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
    let vec: &mut ArenaVec<Self> = unsafe { &mut *crate::current_heap().get(addr) };
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

#[thread_local]
pub static mut HEAP: Option<&'static PageAllocator> = None;
#[thread_local]
pub static mut ARENA: Option<&'static mut Arena> = None;

pub fn current_heap<'a>() -> &'a PageAllocator {
  unsafe { HEAP.unwrap_unchecked() }
}

pub fn current_arena<'a>() -> &'a mut Arena {
  unsafe { ARENA.as_mut().unwrap_unchecked() }
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
