#[cfg(target_arch = "wasm32")]
use std::alloc::{alloc, Layout};

#[cfg(target_os = "macos")]
#[global_allocator]
static GLOBAL: jemallocator::Jemalloc = jemallocator::Jemalloc;

#[cfg(windows)]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod resolver;
mod transformer;
#[cfg(not(target_arch = "wasm32"))]
mod fs_search;
#[cfg(not(target_arch = "wasm32"))]
mod image;
mod hash;

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
{
  use core::num::NonZeroU32;
  use getrandom::Error;
  use getrandom::register_custom_getrandom;

  // Some application-specific error code
  const MY_CUSTOM_ERROR_CODE: u32 = Error::CUSTOM_START + 42;
  pub fn always_fail(buf: &mut [u8]) -> Result<(), Error> {
    let code = NonZeroU32::new(MY_CUSTOM_ERROR_CODE).unwrap();
    Err(Error::from(code))
  }

  register_custom_getrandom!(always_fail);
}
