#![deny(unused_crate_dependencies)]

use getrandom as _;
use napi_derive::napi;
use std::alloc::alloc;
use std::alloc::Layout;

pub mod hash;

pub mod file_system;
pub mod function_ref;
pub mod resolver;
pub mod transformer;

#[no_mangle]
pub extern "C" fn napi_wasm_malloc(size: usize) -> *mut u8 {
  let align = std::mem::align_of::<usize>();
  if let Ok(layout) = Layout::from_size_align(size, align) {
    unsafe {
      if layout.size() > 0 {
        let ptr = alloc(layout);
        if !ptr.is_null() {
          return ptr;
        }
      } else {
        return align as *mut u8;
      }
    }
  }

  std::process::abort();
}

#[link(wasm_import_module = "env")]
extern "C" {
  fn log(ptr: *const u8, len: usize);
}

#[napi]
pub fn init_panic_hook() {
  std::panic::set_hook(Box::new(|p| {
    let s = p.to_string();
    unsafe {
      log(s.as_ptr(), s.len());
    }
  }));
}
