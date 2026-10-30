//! The bodies of the entry points [`register_plugin!`](crate::register_plugin)
//! exports, generic over the plugin type.
//!
//! The macro expands in the plugin's crate, so everything it calls has to be
//! public. Keeping the bodies here, rather than in the macro, keeps that to these
//! `#[doc(hidden)]` functions. They take Parcel's structs as untyped pointers, so
//! the raw types, whose buffers free themselves through Parcel, never become
//! reachable, let alone constructible, from safe code outside the SDK.

// The closures return what the plugin's methods do, whose error type is the
// public `Diagnostic`, so its size is not this module's to choose.
#![allow(clippy::result_large_err)]

use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind};

use crate::{
  Asset, Bundle, BundleGraph, ContentBuffer, Dependency, Diagnostic, Options, Plugin, ReportEvent,
  api, ffi, panic_message,
};

/// Runs `call`, turning a panic into a diagnostic naming `scope`, and writes
/// any failure to `diagnostic`. Returns the result on success.
pub(crate) fn guard<R>(
  scope: &str,
  diagnostic: *mut ffi::DiagnosticOptions,
  call: impl FnOnce() -> Result<R, Diagnostic>,
) -> Option<R> {
  let error = match catch_unwind(AssertUnwindSafe(call)) {
    Ok(Ok(value)) => return Some(value),
    Ok(Err(error)) => error,
    Err(payload) => Diagnostic::new(format!(
      "plugin panicked in {scope}: {}",
      panic_message(payload)
    )),
  };
  // A NULL out-param is written nothing; otherwise it is the one Parcel passed.
  unsafe { error.write_to_raw(diagnostic) };
  None
}

/// # Safety
///
/// Called only as `parcel_plugin_init`, with the arguments Parcel passed.
pub unsafe fn init<T: Plugin>(
  api: *const c_void,
  config: *const u8,
  config_len: usize,
  out_state: *mut *mut c_void,
  diagnostic: *mut c_void,
) -> u8 {
  unsafe { init_typed::<T>(api.cast(), config, config_len, out_state, diagnostic.cast()) }.0
}

unsafe fn init_typed<T: Plugin>(
  api: *const ffi::ParcelApi,
  config: *const u8,
  config_len: usize,
  out_state: *mut *mut c_void,
  diagnostic: *mut ffi::DiagnosticOptions,
) -> ffi::InitStatus {
  // Must come first: every other SDK call, including writing a diagnostic, goes
  // through this table. Returning Incompatible rather than a message is what
  // keeps that from being circular — Parcel writes the message.
  if !unsafe { api::init_api(api) } {
    return ffi::InitStatus::Incompatible;
  }

  let config = if config.is_null() || config_len == 0 {
    &[] as &[u8]
  } else {
    unsafe { std::slice::from_raw_parts(config, config_len) }
  };
  match guard("init", diagnostic, || T::new(config)) {
    Some(plugin) => {
      if !out_state.is_null() {
        unsafe { *out_state = Box::into_raw(Box::new(plugin)) as *mut c_void };
      }
      ffi::InitStatus::Ok
    }
    None => ffi::InitStatus::Error,
  }
}

/// # Safety
///
/// Called only as `parcel_plugin_deinit`, with a state `init::<T>` created.
pub unsafe fn deinit<T: Plugin>(state: *mut c_void) {
  if state.is_null() {
    return;
  }
  // A panic in the plugin's `Drop` must not unwind into Parcel. There is no
  // diagnostic to report it through, so it goes no further than the panic hook.
  let _ = catch_unwind(AssertUnwindSafe(|| {
    drop(unsafe { Box::from_raw(state as *mut T) })
  }));
}

/// # Safety
///
/// Called only as `parcel_plugin_transform`, with the arguments Parcel passed.
pub unsafe fn transform<T: Plugin>(
  raw_asset: u64,
  raw_options: u64,
  state: *mut c_void,
  diagnostic: *mut c_void,
) {
  let diagnostic: *mut ffi::DiagnosticOptions = diagnostic.cast();
  let mut asset = unsafe { Asset::from_raw(raw_asset, raw_options) };
  let options = unsafe { Options::from_raw(raw_options) };
  let plugin = unsafe { &*(state as *const T) };
  guard("transform", diagnostic, || {
    plugin.transform(&mut asset, &options)
  });
}

/// # Safety
///
/// Called only as `parcel_plugin_resolve`, with the arguments Parcel passed.
#[allow(clippy::too_many_arguments)]
pub unsafe fn resolve<T: Plugin>(
  raw_dependency: u64,
  specifier: *const u8,
  specifier_len: usize,
  pipeline: *const u8,
  pipeline_len: usize,
  raw_options: u64,
  result: *mut c_void,
  state: *mut c_void,
  diagnostic: *mut c_void,
) {
  let diagnostic: *mut ffi::DiagnosticOptions = diagnostic.cast();
  let result: *mut ffi::ResolveResult = result.cast();
  let specifier = unsafe {
    std::str::from_utf8(std::slice::from_raw_parts(specifier, specifier_len)).unwrap_or("")
  };
  let pipeline = if pipeline.is_null() || pipeline_len == 0 {
    None
  } else {
    unsafe { std::str::from_utf8(std::slice::from_raw_parts(pipeline, pipeline_len)) }.ok()
  };
  let dependency = unsafe { Dependency::from_raw(raw_dependency, raw_options) };
  let options = unsafe { Options::from_raw(raw_options) };
  let plugin = unsafe { &*(state as *const T) };
  guard("resolve", diagnostic, || {
    let resolution = plugin.resolve(&dependency, specifier, pipeline, &options)?;
    if !result.is_null() {
      unsafe { resolution.write_to_raw(result) }?;
    }
    Ok(())
  });
}

/// # Safety
///
/// Called only as `parcel_plugin_name`, with the arguments Parcel passed.
pub unsafe fn name<T: Plugin>(
  raw_bundle_graph: u64,
  raw_bundle: u64,
  raw_options: u64,
  name: *mut c_void,
  state: *mut c_void,
  diagnostic: *mut c_void,
) {
  let diagnostic: *mut ffi::DiagnosticOptions = diagnostic.cast();
  let name: *mut ffi::Buffer = name.cast();
  let bundle_graph = unsafe { BundleGraph::from_raw(raw_bundle_graph, raw_options) };
  let bundle = unsafe { Bundle::from_raw(raw_bundle, raw_options) };
  let options = unsafe { Options::from_raw(raw_options) };
  let plugin = unsafe { &*(state as *const T) };
  if let Some(Some(chosen)) = guard("name", diagnostic, || {
    plugin.name(&bundle_graph, &bundle, &options)
  }) && !name.is_null()
  {
    unsafe { api::buffer_write_utf8(name, chosen.as_ptr(), chosen.len()) };
  }
}

/// # Safety
///
/// Called only as `parcel_plugin_optimize`, with the arguments Parcel passed.
#[allow(clippy::too_many_arguments)]
pub unsafe fn optimize<T: Plugin>(
  raw_bundle_graph: u64,
  raw_bundle: u64,
  contents: *const u8,
  contents_len: usize,
  source_map: *const u8,
  source_map_len: usize,
  raw_options: u64,
  result: *mut c_void,
  state: *mut c_void,
  diagnostic: *mut c_void,
) {
  let diagnostic: *mut ffi::DiagnosticOptions = diagnostic.cast();
  let result: *mut ffi::OptimizeResult = result.cast();
  let bundle_graph = unsafe { BundleGraph::from_raw(raw_bundle_graph, raw_options) };
  let bundle = unsafe { Bundle::from_raw(raw_bundle, raw_options) };
  let contents = if contents.is_null() || contents_len == 0 {
    &[]
  } else {
    unsafe { std::slice::from_raw_parts(contents, contents_len) }
  };
  let source_map = if source_map.is_null() {
    None
  } else if source_map_len == 0 {
    Some(&[][..])
  } else {
    Some(unsafe { std::slice::from_raw_parts(source_map, source_map_len) })
  };
  let options = unsafe { Options::from_raw(raw_options) };
  let plugin = unsafe { &*(state as *const T) };
  let Some(optimized) = guard("optimize", diagnostic, || {
    plugin.optimize(&bundle_graph, &bundle, contents, source_map, &options)
  }) else {
    return;
  };
  if result.is_null() {
    return;
  }
  unsafe {
    match optimized.contents {
      ContentBuffer::Bytes(contents) => {
        api::buffer_write(&mut (*result).contents, contents.as_ptr(), contents.len())
      }
      ContentBuffer::String(contents) => {
        api::buffer_write_utf8(&mut (*result).contents, contents.as_ptr(), contents.len())
      }
    }
    if let Some(source_map) = optimized.source_map {
      api::buffer_write(
        &mut (*result).source_map,
        source_map.as_ptr(),
        source_map.len(),
      );
    }
  }
}

/// # Safety
///
/// Called only as `parcel_plugin_report`, with the arguments Parcel passed.
pub unsafe fn report<T: Plugin>(
  event: *const c_void,
  raw_options: u64,
  state: *mut c_void,
  diagnostic: *mut c_void,
) {
  let diagnostic: *mut ffi::DiagnosticOptions = diagnostic.cast();
  // An event kind this SDK predates. Reporting nothing is the only correct
  // thing to do with it.
  let Some(event) = (unsafe { ReportEvent::from_raw(event.cast(), raw_options) }) else {
    return;
  };
  let options = unsafe { Options::from_raw(raw_options) };
  let plugin = unsafe { &*(state as *const T) };
  guard("report", diagnostic, || plugin.report(&event, &options));
}
