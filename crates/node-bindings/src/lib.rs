#![allow(dead_code)]

#[cfg(feature = "canary")]
mod init_sentry;

#[cfg(target_arch = "wasm32")]
use std::alloc::{alloc, Layout};

#[cfg(target_os = "macos")]
#[global_allocator]
static GLOBAL: jemallocator::Jemalloc = jemallocator::Jemalloc;

#[cfg(windows)]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[cfg(not(target_arch = "wasm32"))]
mod fs_search;
mod hash;
#[cfg(not(target_arch = "wasm32"))]
mod image;
mod resolver;
mod transformer;

#[cfg(target_arch = "wasm32")]
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

#[cfg(target_arch = "wasm32")]
mod wasm {
  use napi_derive::napi;

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
}
