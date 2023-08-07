use lazy_static::lazy_static;
use napi::{Env, NapiValue};
use napi_derive::napi;
use parcel_db::{Dependency, ParcelDb};

pub static DB: ParcelDb = ParcelDb::new();

#[napi]
pub fn get_heap(env: Env) -> napi::Result<napi::JsBuffer> {
  let (ptr, len) = DB.heap();
  unsafe {
    Ok(
      env
        .create_buffer_with_borrowed_data(ptr, len, 0, napi::noop_finalize)?
        .into_raw(),
    )
  }
}

#[napi]
pub fn get_heap_base() -> u64 {
  let (ptr, _) = DB.heap();
  ptr as u64
}

#[napi]
pub fn alloc(size: u32) -> u32 {
  DB.alloc(size)
}

type CreateExternalString = unsafe extern "C" fn(
  env: napi::sys::napi_env,
  str: *const std::os::raw::c_char,
  length: usize,
  finalize_cb: napi::sys::napi_finalize,
  finalize_hint: *mut std::os::raw::c_void,
  result: *mut napi::sys::napi_value,
  copied: *mut bool,
) -> napi::sys::napi_status;

lazy_static! {
  static ref CREATE_EXTERNAL_STRING: Option<CreateExternalString> = {
    unsafe {
      let ptr = libc::dlsym(
        libc::RTLD_DEFAULT,
        "node_api_create_external_string_latin1\0".as_ptr() as *const _,
      );
      if !ptr.is_null() {
        Some(std::mem::transmute_copy::<
          *mut libc::c_void,
          CreateExternalString,
        >(&ptr))
      } else {
        None
      }
    }
  };
}

unsafe extern "C" fn finalize(
  env: napi::sys::napi_env,
  _finalize_data: *mut std::os::raw::c_void,
  _finalize_hint: *mut std::os::raw::c_void,
) {
}

#[napi]
pub fn read_string(addr: u32, env: Env) -> napi::Result<napi::JsString> {
  let string = DB.read_string(addr);
  if let Some(node_api_create_external_string_latin1) = *CREATE_EXTERNAL_STRING {
    let mut value = std::ptr::null_mut();
    let status = unsafe {
      node_api_create_external_string_latin1(
        env.raw(),
        string.as_ptr() as *const std::os::raw::c_char,
        string.len(),
        Some(finalize),
        std::ptr::null_mut(),
        &mut value,
        std::ptr::null_mut(),
      )
    };
    if status != napi::sys::Status::napi_ok {
      return Err(napi::Error::new(
        napi::Status::GenericFailure,
        "Failed to create string",
      ));
    }
    Ok(unsafe { napi::JsString::from_raw_unchecked(env.raw(), value) })
  } else {
    env.create_string(string)
  }
}

#[napi]
pub fn write_string(addr: u32, s: String) {
  DB.write_string(addr, s)
}

#[napi]
pub fn extend_vec(addr: u32, size: u32, count: u32) {
  DB.extend_vec(addr, size, count)
}

#[napi]
pub fn create_environment(addr: u32) -> u32 {
  DB.environment_id(addr)
}

#[napi]
pub fn debug(addr: u32) {
  let dep = DB.read_heap::<Dependency>(addr);
  println!("{:?}", dep);
}
