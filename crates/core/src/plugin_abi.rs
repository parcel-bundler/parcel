use libloading::{Library, Symbol};
use std::{
  cell::RefCell,
  ffi::{CStr, c_char},
  path::Path,
  sync::{Arc, Mutex},
};

use crate::{Asset, AssetType, BufferContent, DiagnosticList, Transformer};

#[repr(C)]
pub struct Buffer {
  pub data: *mut u8,
  pub len: usize,
  pub cap: usize,
}

#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_content(buffer: *mut Buffer, asset: *const Asset) {
  if buffer.is_null() || asset.is_null() {
    return;
  }

  let asset: &Asset = unsafe { &*asset };
  let mut content = asset.content.read().unwrap();
  unsafe {
    (*buffer).data = content.as_mut_ptr();
    (*buffer).len = content.len();
    (*buffer).cap = content.capacity();
  }
  std::mem::forget(content);
}

#[unsafe(no_mangle)]
pub extern "C" fn parcel_free_buffer(buf: Buffer) {
  drop(unsafe { Vec::from_raw_parts(buf.data, buf.len, buf.cap) })
}

#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_set_content(asset: *mut Asset, buf: *const u8, len: u32) {
  let asset = unsafe { &mut *asset };
  let vec = unsafe { std::slice::from_raw_parts(buf, len as usize).to_vec() };
  asset.content = Arc::new(BufferContent::new(vec));
}

#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_set_type(asset: *mut Asset, ty: *const c_char) {
  let asset = unsafe { &mut *asset };
  let ext = unsafe { CStr::from_ptr(ty).to_str().unwrap() };
  asset.ty = AssetType::from_extension(ext);
}

pub struct CPlugin {
  lib: Library,
}

impl CPlugin {
  pub fn new(path: &Path) -> CPlugin {
    CPlugin {
      lib: unsafe { Library::new(path).unwrap() },
    }
  }
}

impl Transformer for CPlugin {
  fn transform(
    &self,
    mut asset: Asset,
    _options: &crate::ParcelOptions,
  ) -> Result<Asset, DiagnosticList> {
    let transform: Symbol<extern "C" fn(*mut Asset)> = unsafe {
      self
        .lib
        .get(b"parcel_plugin_transform")
        .expect("Failed to find symbol")
    };

    transform(&mut asset);
    Ok(asset)
  }
}

// #[repr(C)]
// struct WasmBuffer {
//   ptr: u32,
//   len: u32,
//   cap: u32,
// }

// fn parcel_asset_get_content_wasm(
//   mut caller: wasmtime::Caller<'_, wasmtime_wasi::p1::WasiP1Ctx>,
//   buffer_ptr: i32,
//   asset_ptr: u64,
// ) {
//   let mem = caller.get_export("memory").unwrap().into_memory().unwrap();
//   let asset = asset_ptr as *mut Asset;
//   let asset: &Asset = unsafe { &*asset };
//   let content = asset.content.read().unwrap();
//   let malloc = caller
//     .get_export("malloc")
//     .unwrap()
//     .into_func()
//     .unwrap()
//     .typed::<u32, u32>(&caller)
//     .unwrap();
//   let len = content.len() as u32;
//   let ptr = malloc.call(&mut caller, len).unwrap();
//   mem
//     .write(&mut caller, ptr as usize, content.as_slice())
//     .unwrap();
//   let buffer = WasmBuffer { ptr, len, cap: len };
//   let bytes = unsafe {
//     std::slice::from_raw_parts(
//       (&buffer as *const WasmBuffer) as *const u8,
//       std::mem::size_of::<WasmBuffer>(),
//     )
//   };
//   mem.write(&mut caller, buffer_ptr as usize, bytes).unwrap();
// }

// fn parcel_free_buffer_wasm(
//   mut caller: wasmtime::Caller<'_, wasmtime_wasi::p1::WasiP1Ctx>,
//   buffer_ptr: i32,
// ) {
//   let mem = caller.get_export("memory").unwrap().into_memory().unwrap();
//   let free = caller
//     .get_export("free")
//     .unwrap()
//     .into_func()
//     .unwrap()
//     .typed::<u32, ()>(&caller)
//     .unwrap();

//   let mut buffer = WasmBuffer {
//     ptr: 0,
//     len: 0,
//     cap: 0,
//   };
//   let bytes = unsafe {
//     std::slice::from_raw_parts_mut(
//       (&mut buffer as *const WasmBuffer) as *mut u8,
//       std::mem::size_of::<WasmBuffer>(),
//     )
//   };
//   mem.read(&caller, buffer_ptr as usize, bytes).unwrap();

//   free.call(&mut caller, buffer.ptr).unwrap();
// }

// pub struct WasmPlugin {
//   store: Mutex<wasmtime::Store<wasmtime_wasi::p1::WasiP1Ctx>>,
//   mem: wasmtime::Memory,
//   malloc: wasmtime::TypedFunc<u32, i32>,
//   transform: wasmtime::TypedFunc<u64, ()>,
// }

// impl WasmPlugin {
//   pub fn new(path: &Path) -> WasmPlugin {
//     use wasmtime::*;
//     use wasmtime_wasi::WasiCtxBuilder;

//     let engine = Engine::default();

//     let mut linker: Linker<wasmtime_wasi::p1::WasiP1Ctx> = Linker::new(&engine);
//     wasmtime_wasi::p1::add_to_linker_sync(&mut linker, |t: &mut _| t).unwrap();

//     linker
//       .func_wrap(
//         "env",
//         "parcel_asset_get_content",
//         parcel_asset_get_content_wasm,
//       )
//       .unwrap();

//     linker
//       .func_wrap("env", "parcel_free_buffer", parcel_free_buffer_wasm)
//       .unwrap();

//     linker
//       .func_wrap(
//         "env",
//         "parcel_asset_set_content",
//         |mut caller: Caller<'_, wasmtime_wasi::p1::WasiP1Ctx>,
//          asset_ptr: u64,
//          buf_ptr: i32,
//          len: i32| {
//           let mem = caller.get_export("memory").unwrap().into_memory().unwrap();
//           let mem_ptr = mem.data_ptr(&caller);
//           let asset = asset_ptr as *mut Asset;
//           let buf: *const u8 = unsafe { mem_ptr.add(buf_ptr as usize).cast() };
//           parcel_asset_set_content(asset, buf, len as u32);
//         },
//       )
//       .unwrap();

//     linker
//       .func_wrap(
//         "env",
//         "parcel_asset_set_type",
//         |mut caller: Caller<'_, wasmtime_wasi::p1::WasiP1Ctx>, asset_ptr: u64, type_ptr: i32| {
//           let mem = caller.get_export("memory").unwrap().into_memory().unwrap();
//           let mem_ptr = mem.data_ptr(&caller);
//           let asset = asset_ptr as *mut Asset;
//           let ty: *const c_char = unsafe { mem_ptr.add(type_ptr as usize).cast() };
//           parcel_asset_set_type(asset, ty);
//         },
//       )
//       .unwrap();

//     linker
//       .func_wrap(
//         "env",
//         "abort",
//         |mut caller: Caller<'_, wasmtime_wasi::p1::WasiP1Ctx>,
//          message: u32,
//          filename: u32,
//          line: u32,
//          col: u32| {
//           todo!("abort");
//           ()
//         },
//       )
//       .unwrap();

//     let wasi_ctx = WasiCtxBuilder::new()
//       .inherit_stdout()
//       .inherit_stderr()
//       .build_p1();

//     let mut store = Store::new(&engine, wasi_ctx);
//     let module: Module = Module::from_file(&engine, path).unwrap();
//     let instance = linker.instantiate(&mut store, &module).unwrap();
//     let malloc = instance
//       .get_typed_func::<u32, i32>(&mut store, "malloc")
//       .unwrap();
//     let func = instance
//       .get_typed_func::<u64, ()>(&mut store, "parcel_plugin_transform")
//       .unwrap();
//     let mem: Memory = instance
//       .get_export(&mut store, "memory")
//       .unwrap()
//       .into_memory()
//       .unwrap();

//     // linker.func_new(module, name, ty, func)
//     WasmPlugin {
//       store: Mutex::new(store),
//       mem,
//       malloc,
//       transform: func,
//     }
//   }
// }

// impl Transformer for WasmPlugin {
//   fn transform(
//     &self,
//     mut asset: Asset,
//     _options: &crate::ParcelOptions,
//   ) -> Result<Asset, crate::DiagnosticList> {
//     let mut store = self.store.lock().unwrap();

//     let ptr = (&mut asset) as *mut Asset as u64;
//     self.transform.call(&mut *store, ptr).unwrap();

//     println!("{:?}", asset);
//     Ok(asset)
//   }
// }
