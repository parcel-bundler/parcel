use std::cell::RefCell;

use allocator_api2::alloc::Layout;

use crate::atomics::AtomicVec;

thread_local! {
  pub static HEAP: RefCell<Option<&'static PageAllocator>> = const { RefCell::new(None) };
}

pub fn current_heap<'a>() -> &'a PageAllocator {
  unsafe { HEAP.with(|heap| heap.borrow().unwrap_unchecked()) }
}

const PAGE_SIZE: usize = 65536;
const PTR_MAX: u32 = u32::MAX;
const NUM_PAGES: u32 = PTR_MAX / (PAGE_SIZE as u32) + 1;
const PAGE_INDEX_SIZE: u32 = NUM_PAGES.ilog2();
const PAGE_INDEX_SHIFT: u32 = 32 - PAGE_INDEX_SIZE;
const PAGE_INDEX_MASK: u32 = ((1 << PAGE_INDEX_SIZE) - 1) << PAGE_INDEX_SHIFT;
const PAGE_OFFSET_MASK: u32 = (1 << PAGE_INDEX_SHIFT) - 1;

#[inline]
pub fn unpack_addr(addr: u32) -> (u32, u32) {
  let page_index = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  (page_index, offset)
}

#[inline]
pub fn pack_addr(page: u32, offset: u32) -> u32 {
  (page << PAGE_INDEX_SHIFT) | (offset & PAGE_OFFSET_MASK)
}

pub struct PageAllocator {
  pub pages: AtomicVec<Page>,
}

unsafe impl Send for PageAllocator {}

pub struct Page {
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

  pub fn alloc_page(&self, min_size: usize, zeroed: bool) -> u32 {
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
    let page = &self.pages.get(index).expect("Invalid page");
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
