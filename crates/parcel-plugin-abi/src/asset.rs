//! Asset content, metadata, flags, and symbols.

use std::{borrow::Cow, ffi::c_void, sync::Arc};

use parcel_core::{
  Asset as CoreAsset, AssetFlags as CoreAssetFlags, AssetType, BufferContent, Content, ContentType,
  Diagnostic as CoreDiagnostic, DiagnosticList, LocalSymbol, ParcelOptions, SymbolName,
};

use crate::{
  Asset, Buffer, Bundle, BundleBehavior, BundleGraph, Diagnostic, Options, bytes_to_str,
  read_cdiagnostic, write_buffer,
};

#[repr(u32)]
#[derive(Debug, Clone, Copy, Hash)]
pub enum AssetFlags {
  PARCEL_ASSET_IS_SOURCE = 1 << 0,
  PARCEL_ASSET_SIDE_EFFECTS = 1 << 1,
  PARCEL_ASSET_IS_BUNDLE_SPLITTABLE = 1 << 2,
  PARCEL_ASSET_LARGE_BLOB = 1 << 3,
  PARCEL_ASSET_HAS_CJS_EXPORTS = 1 << 4,
  PARCEL_ASSET_STATIC_EXPORTS = 1 << 5,
  PARCEL_ASSET_SHOULD_WRAP = 1 << 6,
  PARCEL_ASSET_IS_CONSTANT_MODULE = 1 << 7,
  PARCEL_ASSET_HAS_NODE_REPLACEMENTS = 1 << 8,
  PARCEL_ASSET_HAS_SYMBOLS = 1 << 9,
  PARCEL_ASSET_IS_HTML_ATTR = 1 << 10,
  PARCEL_ASSET_IS_HTML_TAG = 1 << 11,
  PARCEL_ASSET_IS_ESM = 1 << 12,
}

pub type AssetFlagsFFI = u32;

assert_flag_values! {
  core = CoreAssetFlags,
  abi = AssetFlags,
  repr = u32;
  flags = {
    IS_SOURCE => PARCEL_ASSET_IS_SOURCE,
    SIDE_EFFECTS => PARCEL_ASSET_SIDE_EFFECTS,
    IS_BUNDLE_SPLITTABLE => PARCEL_ASSET_IS_BUNDLE_SPLITTABLE,
    LARGE_BLOB => PARCEL_ASSET_LARGE_BLOB,
    HAS_CJS_EXPORTS => PARCEL_ASSET_HAS_CJS_EXPORTS,
    STATIC_EXPORTS => PARCEL_ASSET_STATIC_EXPORTS,
    SHOULD_WRAP => PARCEL_ASSET_SHOULD_WRAP,
    IS_CONSTANT_MODULE => PARCEL_ASSET_IS_CONSTANT_MODULE,
    HAS_NODE_REPLACEMENTS => PARCEL_ASSET_HAS_NODE_REPLACEMENTS,
    HAS_SYMBOLS => PARCEL_ASSET_HAS_SYMBOLS,
    IS_HTML_ATTR => PARCEL_ASSET_IS_HTML_ATTR,
    IS_HTML_TAG => PARCEL_ASSET_IS_HTML_TAG,
    IS_ESM => PARCEL_ASSET_IS_ESM,
  }
  ignored = [AUTOMATIC_JSX_RUNTIME];
}

// ── Content ───────────────────────────────────────────────────────────────────

/// Returns the asset content into `*buf`. Caller must `parcel_free_buffer(buf)`.
pub extern "C" fn parcel_asset_get_content(buf: *mut Buffer, asset: Asset) {
  if buf.is_null() {
    return;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  let Ok(content) = asset.content.read() else {
    return;
  };
  unsafe { write_buffer(buf, content, false) };
}

/// Returns the asset content as a UTF-8 string into `*buf`. Caller must `parcel_free_buffer(buf)`.
pub extern "C" fn parcel_asset_get_content_utf8(buf: *mut Buffer, asset: Asset) {
  if buf.is_null() {
    return;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  let Ok(content) = asset.content.read_string() else {
    return;
  };
  unsafe { write_buffer(buf, content.into_owned().into_bytes(), true) };
}

/// Replaces the asset content with the given bytes.
pub extern "C" fn parcel_asset_set_content(asset: Asset, data: *const u8, len: u32) {
  if data.is_null() {
    return;
  }
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  let vec = unsafe { std::slice::from_raw_parts(data, len as usize).to_vec() };
  asset.content = Arc::new(BufferContent::new(vec));
}

/// Replaces the asset content with the given UTF-8 bytes.
/// It is the caller's responsibility to validate that the data is valid UTF-8.
pub extern "C" fn parcel_asset_set_content_utf8(asset: Asset, data: *const u8, len: u32) {
  if data.is_null() {
    return;
  }
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  let string =
    unsafe { String::from_utf8_unchecked(std::slice::from_raw_parts(data, len as usize).to_vec()) };
  asset.content = Arc::new(BufferContent::new_string(string));
}

#[derive(Debug)]
struct CContent {
  ty: [u8; 16],
  ptr: *mut c_void,
  read: extern "C" fn(content: *const c_void, buf: *mut Buffer, diagnostic: *mut Diagnostic),
  package: Option<
    extern "C" fn(
      content: *const c_void,
      bundle_graph: BundleGraph,
      bundle: Bundle,
      options: Options,
      buf: *mut Buffer,
      diagnostic: *mut Diagnostic,
    ),
  >,
  free: extern "C" fn(content: *mut c_void),
}

unsafe impl Send for CContent {}
unsafe impl Sync for CContent {}

impl Drop for CContent {
  fn drop(&mut self) {
    (self.free)(self.ptr);
  }
}

impl Content for CContent {
  fn ty(&self) -> ContentType {
    ContentType::from_bytes(self.ty)
  }

  fn read(&self) -> Result<Vec<u8>, CoreDiagnostic> {
    let mut buf = Buffer::default();
    let mut diagnostic = Diagnostic::default();

    (self.read)(self.ptr, &mut buf, &mut diagnostic);

    let buf = if !buf.data.is_null() {
      unsafe { Vec::from_raw_parts(buf.data, buf.len, buf.cap) }
    } else {
      Vec::new()
    };

    if let Some(diag) = read_cdiagnostic(&mut diagnostic, None) {
      return Err(diag);
    }

    Ok(buf)
  }

  fn read_string(&self) -> Result<Cow<'_, str>, CoreDiagnostic> {
    let mut buf = Buffer::default();
    let mut diagnostic = Diagnostic::default();

    (self.read)(self.ptr, &mut buf, &mut diagnostic);

    let bytes = if !buf.data.is_null() {
      unsafe { Vec::from_raw_parts(buf.data, buf.len, buf.cap) }
    } else {
      Vec::new()
    };

    if let Some(diag) = read_cdiagnostic(&mut diagnostic, None) {
      return Err(diag);
    }

    if buf.is_utf8 {
      Ok(Cow::Owned(unsafe { String::from_utf8_unchecked(bytes) }))
    } else {
      Ok(Cow::Owned(String::from_utf8(bytes)?))
    }
  }

  fn package(
    &self,
    bundle_graph: &parcel_core::BundleGraph,
    bundle: &parcel_core::Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    if let Some(package) = self.package {
      let mut buf = Buffer::default();
      let mut diagnostic = Diagnostic::default();

      (package)(
        self.ptr,
        bundle_graph as *const parcel_core::BundleGraph as BundleGraph,
        bundle as *const parcel_core::Bundle as Bundle,
        options as *const ParcelOptions as Options,
        &mut buf,
        &mut diagnostic,
      );

      let bytes = if !buf.data.is_null() {
        unsafe { Vec::from_raw_parts(buf.data, buf.len, buf.cap) }
      } else {
        Vec::new()
      };

      if let Some(diag) = read_cdiagnostic(&mut diagnostic, None) {
        return Err(DiagnosticList(vec![diag]));
      }

      let content = if buf.is_utf8 {
        Arc::new(BufferContent::new_string(unsafe {
          String::from_utf8_unchecked(bytes)
        }))
      } else {
        Arc::new(BufferContent::new(bytes))
      };
      Ok(content)
    } else {
      Content::package(
        self,
        bundle_graph,
        bundle,
        get_inline_bundle_content,
        options,
      )
    }
  }
}

/// Replaces the asset content with a custom content type.
pub extern "C" fn parcel_asset_set_custom_content(
  asset: Asset,
  ty: *const [u8; 16],
  content: *mut c_void,
  // Callback to read the content to a buffer. Bytes should be written into the buffer using parcel_buffer_write.
  read: Option<
    extern "C" fn(content: *const c_void, buf: *mut Buffer, diagnostic: *mut Diagnostic),
  >,
  package: Option<
    extern "C" fn(
      content: *const c_void,
      bundle_graph: BundleGraph,
      bundle: Bundle,
      options: Options,
      buf: *mut Buffer,
      diagnostic: *mut Diagnostic,
    ),
  >,
  free: Option<extern "C" fn(content: *mut c_void)>,
) {
  let content = CContent {
    ty: unsafe { *ty },
    ptr: content,
    read: read.expect("a read callback must be provided to parcel_asset_set_content"),
    package,
    free: free.expect("a free callback must be provided to parcel_asset_set_content"),
  };

  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  asset.content = Arc::new(content);
}

/// Gets the custom content and type identifier for `asset`. Returns true if the output parameters were set.
pub extern "C" fn parcel_asset_get_custom_content(
  ty: *mut [u8; 16],
  content: *mut *mut c_void,
  asset: Asset,
) -> bool {
  if content.is_null() || ty.is_null() {
    return false;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  if let Some(value) = asset.content.downcast_ref::<CContent>() {
    unsafe {
      *ty = value.ty;
      *content = value.ptr
    };
    true
  } else {
    false
  }
}

// ── Type ──────────────────────────────────────────────────────────────────────

/// Returns the asset type extension (e.g. `"js"`, `"css"`) into `*buf`.
/// Caller must `parcel_free_buffer(buf)`.
pub extern "C" fn parcel_asset_get_type(buf: *mut Buffer, asset: Asset) {
  if buf.is_null() {
    return;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  unsafe { write_buffer(buf, asset.ty.extension().as_bytes().to_vec(), true) };
}

/// Changes the asset type to the given file-extension bytes (e.g. `"js"`).
pub extern "C" fn parcel_asset_set_type(asset: Asset, ty: *const u8, ty_len: usize) {
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  let ext = unsafe { bytes_to_str(ty, ty_len) };
  asset.ty = AssetType::from_extension(ext);
}

// ── File path (read-only) ─────────────────────────────────────────────────────

/// Returns the absolute filesystem path of the source asset into `*buf`.
/// `options` is the handle received from `parcel_plugin_transform()`.
/// Caller must `parcel_free_buffer(buf)`.
pub extern "C" fn parcel_asset_get_file_path(buf: *mut Buffer, asset: Asset, _options: Options) {
  if buf.is_null() {
    return;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  let Ok(path) = asset.loc.url.to_file_path() else {
    return;
  };
  unsafe {
    write_buffer(
      buf,
      path
        .to_path_buf()
        .to_string_lossy()
        .into_owned()
        .into_bytes(),
      true,
    )
  };
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/// Returns the named pipeline into `*buf`, or leaves `buf->data == NULL` if none is set.
/// Caller must `parcel_free_buffer(buf)` when `data != NULL`.
pub extern "C" fn parcel_asset_get_pipeline(buf: *mut Buffer, asset: Asset) {
  if buf.is_null() {
    return;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  let Some(pipeline) = &asset.pipeline else {
    return;
  };
  unsafe { write_buffer(buf, pipeline.as_bytes().to_vec(), true) };
}

/// Sets the named pipeline. Pass `NULL` / `0` to clear.
pub extern "C" fn parcel_asset_set_pipeline(
  asset: Asset,
  pipeline: *const u8,
  pipeline_len: usize,
) {
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  if pipeline.is_null() {
    asset.pipeline = None;
  } else {
    let s = unsafe { bytes_to_str(pipeline, pipeline_len) };
    asset.pipeline = Some(s.into());
  }
}

// ── Query (read-only) ─────────────────────────────────────────────────────────

/// Returns the query string from the asset's source URL into `*buf`, or leaves
/// `buf->data == NULL` if the URL has no query.
/// Caller must `parcel_free_buffer(buf)` when `data != NULL`.
pub extern "C" fn parcel_asset_get_query(buf: *mut Buffer, asset: Asset) {
  if buf.is_null() {
    return;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  let Some(query) = asset.loc.url.query() else {
    return;
  };
  unsafe { write_buffer(buf, query.as_bytes().to_vec(), true) };
}

// ── BundleBehavior ────────────────────────────────────────────────────────────

/// Returns the bundle behavior (`PARCEL_BUNDLE_BEHAVIOR_*`).
pub extern "C" fn parcel_asset_get_bundle_behavior(asset: Asset) -> BundleBehavior {
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  asset.bundle_behavior.into()
}

/// Sets the bundle behavior (`PARCEL_BUNDLE_BEHAVIOR_*`).
pub extern "C" fn parcel_asset_set_bundle_behavior(asset: Asset, behavior: BundleBehavior) {
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  asset.bundle_behavior = behavior.into();
}

// ── Flags ─────────────────────────────────────────────────────────────────────

/// Returns the raw `AssetFlags` bitfield (`PARCEL_ASSET_*` bits).
pub extern "C" fn parcel_asset_get_flags(asset: Asset) -> AssetFlagsFFI {
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  asset.flags.bits()
}

/// Replaces the `AssetFlags` bitfield.
pub extern "C" fn parcel_asset_set_flags(asset: Asset, flags: AssetFlagsFFI) {
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  asset.flags = CoreAssetFlags::from_bits_truncate(flags);
}

// ── UniqueKey ─────────────────────────────────────────────────────────────────

/// Returns the unique key into `*buf`, or leaves `buf->data == NULL` if not set.
/// Caller must `parcel_free_buffer(buf)` when `data != NULL`.
pub extern "C" fn parcel_asset_get_unique_key(buf: *mut Buffer, asset: Asset) {
  if buf.is_null() {
    return;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  let Some(key) = &asset.unique_key else {
    return;
  };
  unsafe { write_buffer(buf, key.as_bytes().to_vec(), true) };
}

/// Sets the unique key. Pass `NULL` / `0` to clear.
pub extern "C" fn parcel_asset_set_unique_key(asset: Asset, key: *const u8, key_len: usize) {
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  if key.is_null() {
    asset.unique_key = None;
  } else {
    let s = unsafe { bytes_to_str(key, key_len) };
    asset.unique_key = Some(s.to_owned().into());
  }
}

// ── Symbols ───────────────────────────────────────────────────────────────────

/// Registers an exported symbol name (e.g. `"default"`, `"foo"`, `"*"`).
pub extern "C" fn parcel_asset_add_export_symbol(asset: Asset, name: *const u8, name_len: usize) {
  if name.is_null() {
    return;
  }
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  let name = unsafe { bytes_to_str(name, name_len) };
  asset.symbols.exports.push(LocalSymbol {
    exported: SymbolName::from(name),
    requested: false,
  });
}
