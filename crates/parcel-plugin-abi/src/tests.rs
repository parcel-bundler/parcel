use std::{borrow::Cow, collections::HashMap, ffi::c_void, path::Path, ptr, sync::Arc};

use parcel_core::{
  Asset as CoreAsset, AssetFlags as CoreAssetFlags, AssetGraph, AssetIndex as CoreAssetIndex,
  AssetNode, AssetNodeIndex, AssetRequest, AssetType, BufferContent, Bundle as CoreBundle,
  BundleBehavior as CoreBundleBehavior, BundleFlags as CoreBundleFlags,
  BundleGraph as CoreBundleGraph, Content, ContentWithSourceMap, Dependency as CoreDependency,
  DependencyFlags as CoreDependencyFlags, DependencyId, DependencyResolution, DiagnosticList,
  Environment as CoreEnvironment, EnvironmentFlags as CoreEnvironmentFlags,
  ExportsCondition as CoreExportsCondition, FileCreateInvalidation, FileSystem, ImportType,
  MemoryFileSystem, OutputFormat as CoreOutputFormat, ParcelOptions, PathId, PluginContext,
  Priority as CorePriority, Resolver, SourceLocation, SourceType as CoreSourceType, SourceUrl,
  SpecifierType as CoreSpecifierType, Target as CoreTarget, TrackingFileSystem,
};

use super::*;

fn path(value: &str) -> PathId {
  PathId::new(Path::new(value))
}

fn target_fixture() -> Arc<CoreTarget> {
  Arc::new(CoreTarget {
    environment: CoreEnvironment::Node,
    output_format: CoreOutputFormat::Esmodule,
    source_type: CoreSourceType::Script,
    flags: CoreEnvironmentFlags::IS_LIBRARY | CoreEnvironmentFlags::SHOULD_OPTIMIZE,
    dist_dir: path("/project/dist"),
    public_url: "/assets".into(),
    ..Default::default()
  })
}

fn dependency_fixture(target: Arc<CoreTarget>) -> CoreDependency {
  CoreDependency {
    specifier: "./dependency.js".into(),
    specifier_type: CoreSpecifierType::Esm,
    priority: CorePriority::Sync,
    bundle_behavior: CoreBundleBehavior::None,
    import_type: ImportType::JavaScript, // TODO
    flags: CoreDependencyFlags::OPTIONAL | CoreDependencyFlags::SIDE_EFFECTS,
    target,
    loc: Some(SourceLocation {
      url: SourceUrl::from_path(&path("/project/src/source.js")),
      ..Default::default()
    }),
    placeholder: None,
    resolve_from: Some(SourceUrl::from_path(&path("/project/src/resolve-from.js"))),
    range: None,
    conditions: CoreExportsCondition::IMPORT | CoreExportsCondition::BROWSER,
    resolution: DependencyResolution::None,
    concurrent_group: 0,
    custom_conditions: Default::default(),
  }
}

fn asset_fixture(target: Arc<CoreTarget>) -> CoreAsset {
  CoreAsset {
    loc: SourceLocation {
      url: SourceUrl::from_path_and_query(
        &path("/project/src/index.css"),
        Some("transform=true&lang=en"),
      ),
      ..Default::default()
    },
    ty: AssetType::Css,
    content: Arc::new(BufferContent::new_string("hello ABI".into())),
    target,
    pipeline: Some("test-pipeline".into()),
    bundle_behavior: CoreBundleBehavior::Isolated,
    flags: CoreAssetFlags::IS_SOURCE | CoreAssetFlags::SIDE_EFFECTS,
    unique_key: Some("asset-key".into()),
    dependencies: Vec::new(),
    symbols: Default::default(),
  }
}

fn bundle_fixture(target: Arc<CoreTarget>, dist_path: Option<&str>) -> CoreBundle {
  CoreBundle {
    id: 0,
    ty: AssetType::Js,
    target,
    bundle_behavior: CoreBundleBehavior::Inline,
    flags: CoreBundleFlags::ENTRY | CoreBundleFlags::NEEDS_STABLE_NAME,
    dist_path: dist_path.map(path),
    assets: vec![CoreAssetIndex(2), CoreAssetIndex(5)],
    entry_assets: vec![CoreAssetIndex(5)],
    main_entry_asset: Some(CoreAssetIndex(5)),
    referenced_bundles: Vec::new(),
    name_state: Default::default(),
  }
}

fn asset_handle(asset: &CoreAsset) -> Asset {
  asset as *const CoreAsset as Asset
}

fn asset_mut_handle(asset: &mut CoreAsset) -> Asset {
  asset as *mut CoreAsset as Asset
}

fn dependency_handle(dependency: &CoreDependency) -> Dependency {
  dependency as *const CoreDependency as Dependency
}

fn target_handle(target: &CoreTarget) -> Target {
  target as *const CoreTarget as Target
}

fn bundle_handle(bundle: &CoreBundle) -> Bundle {
  bundle as *const CoreBundle as Bundle
}

fn buffer_output(call: impl FnOnce(*mut Buffer)) -> Option<(Vec<u8>, bool)> {
  let mut buffer = Buffer::default();
  call(&mut buffer);
  if buffer.data.is_null() {
    return None;
  }

  let bytes = unsafe { std::slice::from_raw_parts(buffer.data, buffer.len).to_vec() };
  let is_utf8 = buffer.is_utf8;
  parcel_free_buffer(&mut buffer);
  Some((bytes, is_utf8))
}

fn string_output(call: impl FnOnce(*mut Buffer)) -> Option<String> {
  buffer_output(call).map(|(bytes, _)| String::from_utf8(bytes).unwrap())
}

#[test]
fn buffer_ownership_functions_allocate_replace_and_clear() {
  let original = b"original";
  let mut buffer = parcel_buffer_alloc(original.as_ptr(), original.len());
  assert_eq!(
    unsafe { std::slice::from_raw_parts(buffer.data, buffer.len) },
    original
  );
  assert!(!buffer.is_utf8);

  let replacement = b"replacement";
  parcel_buffer_write_utf8(&mut buffer, replacement.as_ptr(), replacement.len());
  assert_eq!(
    unsafe { std::slice::from_raw_parts(buffer.data, buffer.len) },
    replacement
  );
  assert!(buffer.is_utf8);

  parcel_buffer_write(&mut buffer, replacement.as_ptr(), 0);
  assert!(buffer.data.is_null());
  assert_eq!(buffer.len, 0);
  assert_eq!(buffer.cap, 0);
  assert!(!buffer.is_utf8);

  let empty = parcel_buffer_alloc(ptr::null(), 0);
  assert!(empty.data.is_null());
  parcel_free_buffer(ptr::null_mut());
}

#[test]
fn asset_content_setters_attach_source_maps() {
  let mut asset = asset_fixture(target_fixture());
  let handle = &mut asset as *mut CoreAsset as Asset;
  let map = br#"{"version":3,"sources":["a.scss"],"mappings":"AAAA"}"#;

  let code = b".a{}";
  parcel_asset_set_content_utf8_with_map(
    handle,
    code.as_ptr(),
    code.len(),
    map.as_ptr(),
    map.len(),
  );
  let content = asset
    .content
    .downcast_ref::<ContentWithSourceMap>()
    .expect("content with a source map");
  assert_eq!(content.read().unwrap(), code);
  assert_eq!(content.source_map(), map);
  // Still readable as UTF-8 without a copy, like BufferContent::new_string.
  assert_eq!(
    string_output(|buffer| parcel_asset_get_content_utf8(buffer, handle)).as_deref(),
    Some(".a{}")
  );

  let bytes = [0u8, 159, 146, 150];
  parcel_asset_set_content_with_map(handle, bytes.as_ptr(), bytes.len(), map.as_ptr(), map.len());
  let content = asset
    .content
    .downcast_ref::<ContentWithSourceMap>()
    .expect("content with a source map");
  assert_eq!(content.read().unwrap(), bytes);

  // Without a map they behave like the plain setters, dropping the previous map.
  parcel_asset_set_content_utf8_with_map(handle, code.as_ptr(), code.len(), ptr::null(), 0);
  assert!(
    asset
      .content
      .downcast_ref::<ContentWithSourceMap>()
      .is_none()
  );
  assert_eq!(asset.content.read().unwrap(), code);
  parcel_asset_set_content_with_map(handle, bytes.as_ptr(), bytes.len(), map.as_ptr(), 0);
  assert!(
    asset
      .content
      .downcast_ref::<ContentWithSourceMap>()
      .is_none()
  );
}

#[test]
fn asset_map_getter_returns_the_map_set_with_the_content() {
  let mut asset = asset_fixture(target_fixture());
  let handle = &mut asset as *mut CoreAsset as Asset;
  let map = br#"{"version":3,"sources":["a.ts"],"mappings":"AAAA"}"#;

  // Plain content has no map, and the buffer is left untouched.
  assert_eq!(
    buffer_output(|buffer| parcel_asset_get_map(buffer, handle)),
    None
  );

  let code = b"a();";
  parcel_asset_set_content_utf8_with_map(
    handle,
    code.as_ptr(),
    code.len(),
    map.as_ptr(),
    map.len(),
  );
  // Exactly as set, sources and all. Not marked UTF-8: native setters don't validate the map.
  assert_eq!(
    buffer_output(|buffer| parcel_asset_get_map(buffer, handle)),
    Some((map.to_vec(), false))
  );

  // Content set by other plugins (e.g. a JS transformer's `setCode(code, map)`) reads the same way.
  asset.content = Arc::new(ContentWithSourceMap::new(code.to_vec(), map.to_vec()));
  assert_eq!(
    string_output(|buffer| parcel_asset_get_map(buffer, handle)).as_deref(),
    Some(std::str::from_utf8(map).unwrap())
  );

  // Replacing the content without a map drops it.
  parcel_asset_set_content_utf8(handle, code.as_ptr(), code.len() as u32);
  assert_eq!(
    buffer_output(|buffer| parcel_asset_get_map(buffer, handle)),
    None
  );

  // An empty map is no map, like the setters treat it.
  asset.content = Arc::new(ContentWithSourceMap::new(code.to_vec(), Vec::new()));
  assert_eq!(
    buffer_output(|buffer| parcel_asset_get_map(buffer, handle)),
    None
  );

  parcel_asset_get_map(ptr::null_mut(), handle);
  assert_eq!(
    buffer_output(|buffer| parcel_asset_get_map(buffer, 0)),
    None
  );
}

#[test]
fn asset_accessors_return_content_metadata_and_optional_values() {
  let target = target_fixture();
  let mut asset = asset_fixture(target.clone());
  let handle = asset_handle(&asset);

  let (content, is_utf8) =
    buffer_output(|buffer| parcel_asset_get_content(buffer, handle)).unwrap();
  assert_eq!(content, b"hello ABI");
  assert!(!is_utf8);

  let (content, is_utf8) =
    buffer_output(|buffer| parcel_asset_get_content_utf8(buffer, handle)).unwrap();
  assert_eq!(content, b"hello ABI");
  assert!(is_utf8);

  assert_eq!(
    string_output(|buffer| parcel_asset_get_type(buffer, handle)).as_deref(),
    Some("css")
  );
  assert_eq!(
    string_output(|buffer| parcel_asset_get_file_path(buffer, handle, 0)).as_deref(),
    Some("/project/src/index.css")
  );
  assert_eq!(
    string_output(|buffer| parcel_asset_get_query(buffer, handle)).as_deref(),
    Some("transform=true&lang=en")
  );
  assert_eq!(
    string_output(|buffer| parcel_asset_get_pipeline(buffer, handle)).as_deref(),
    Some("test-pipeline")
  );
  assert_eq!(
    parcel_asset_get_bundle_behavior(handle),
    BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_ISOLATED
  );
  assert_eq!(parcel_asset_get_flags(handle), asset.flags.bits());
  assert_eq!(
    string_output(|buffer| parcel_asset_get_unique_key(buffer, handle)).as_deref(),
    Some("asset-key")
  );
  assert_eq!(
    parcel_asset_get_target(handle),
    Arc::as_ptr(&target) as Target
  );

  let behavior_cases = [
    (
      CoreBundleBehavior::None,
      BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE,
    ),
    (
      CoreBundleBehavior::Inline,
      BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_INLINE,
    ),
    (
      CoreBundleBehavior::Isolated,
      BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_ISOLATED,
    ),
  ];
  for (core, abi) in behavior_cases {
    asset.bundle_behavior = core;
    assert_eq!(parcel_asset_get_bundle_behavior(asset_handle(&asset)), abi);
    assert_eq!(CoreBundleBehavior::from(abi), core);
  }

  asset.pipeline = None;
  asset.unique_key = None;
  asset.loc.url = SourceUrl::from_path(&path("/project/src/index.css"));
  let handle = asset_handle(&asset);
  assert!(string_output(|buffer| parcel_asset_get_query(buffer, handle)).is_none());
  assert!(string_output(|buffer| parcel_asset_get_pipeline(buffer, handle)).is_none());
  assert!(string_output(|buffer| parcel_asset_get_unique_key(buffer, handle)).is_none());

  parcel_asset_get_content(ptr::null_mut(), handle);
  parcel_asset_get_type(ptr::null_mut(), handle);
  parcel_asset_get_file_path(ptr::null_mut(), handle, 0);
  parcel_asset_get_query(ptr::null_mut(), handle);
  parcel_asset_get_pipeline(ptr::null_mut(), handle);
  parcel_asset_get_unique_key(ptr::null_mut(), handle);
}

extern "C" fn read_custom_content(
  content: *const c_void,
  buffer: *mut Buffer,
  _diagnostic: *mut Diagnostic,
) {
  let value = unsafe { &*(content as *const String) };
  parcel_buffer_write_utf8(buffer, value.as_ptr(), value.len());
}

extern "C" fn free_custom_content(content: *mut c_void) {
  drop(unsafe { Box::from_raw(content as *mut String) });
}

#[test]
fn custom_content_accessor_distinguishes_and_returns_custom_content() {
  let target = target_fixture();
  let regular_asset = asset_fixture(target.clone());
  let mut ty = [0; 16];
  let mut content = ptr::null_mut();
  assert!(!parcel_asset_get_custom_content(
    &mut ty,
    &mut content,
    asset_handle(&regular_asset),
  ));
  assert!(!parcel_asset_get_custom_content(
    ptr::null_mut(),
    &mut content,
    asset_handle(&regular_asset),
  ));

  let mut asset = asset_fixture(target);
  let expected_ty = *b"parcel-test-type";
  let boxed = Box::new(String::from("custom value"));
  let expected_content = Box::into_raw(boxed) as *mut c_void;
  parcel_asset_set_custom_content(
    asset_mut_handle(&mut asset),
    &expected_ty,
    expected_content,
    Some(read_custom_content),
    None,
    Some(free_custom_content),
  );

  assert!(parcel_asset_get_custom_content(
    &mut ty,
    &mut content,
    asset_handle(&asset),
  ));
  assert_eq!(ty, expected_ty);
  assert_eq!(content, expected_content);
  // Opaque content keeps the input estimate, even when its printed size differs.
  assert_eq!(asset.content.estimate_size().unwrap(), b"hello ABI".len());
  assert_eq!(
    string_output(|buffer| parcel_asset_get_content_utf8(buffer, asset_handle(&asset))).as_deref(),
    Some("custom value")
  );
}

#[test]
fn target_accessors_map_every_enum_variant_and_return_fields() {
  let environment_cases = [
    (CoreEnvironment::Browser, Environment::PARCEL_ENV_BROWSER),
    (
      CoreEnvironment::WebWorker,
      Environment::PARCEL_ENV_WEB_WORKER,
    ),
    (
      CoreEnvironment::ServiceWorker,
      Environment::PARCEL_ENV_SERVICE_WORKER,
    ),
    (CoreEnvironment::Worklet, Environment::PARCEL_ENV_WORKLET),
    (CoreEnvironment::Node, Environment::PARCEL_ENV_NODE),
    (
      CoreEnvironment::ElectronMain,
      Environment::PARCEL_ENV_ELECTRON_MAIN,
    ),
    (
      CoreEnvironment::ElectronRenderer,
      Environment::PARCEL_ENV_ELECTRON_RENDERER,
    ),
    (
      CoreEnvironment::ReactClient,
      Environment::PARCEL_ENV_REACT_CLIENT,
    ),
    (
      CoreEnvironment::ReactServer,
      Environment::PARCEL_ENV_REACT_SERVER,
    ),
  ];
  for (core, abi) in environment_cases {
    let target = CoreTarget {
      environment: core,
      ..Default::default()
    };
    assert_eq!(parcel_target_get_environment(target_handle(&target)), abi);
    assert_eq!(CoreEnvironment::from(abi), core);
  }

  let output_format_cases = [
    (
      CoreOutputFormat::Global,
      OutputFormat::PARCEL_OUTPUT_FORMAT_GLOBAL,
    ),
    (
      CoreOutputFormat::Commonjs,
      OutputFormat::PARCEL_OUTPUT_FORMAT_COMMONJS,
    ),
    (
      CoreOutputFormat::Esmodule,
      OutputFormat::PARCEL_OUTPUT_FORMAT_ESMODULE,
    ),
  ];
  for (core, abi) in output_format_cases {
    let target = CoreTarget {
      output_format: core,
      ..Default::default()
    };
    assert_eq!(parcel_target_get_output_format(target_handle(&target)), abi);
    assert_eq!(CoreOutputFormat::from(abi), core);
  }

  let source_type_cases = [
    (
      CoreSourceType::Module,
      SourceType::PARCEL_SOURCE_TYPE_MODULE,
    ),
    (
      CoreSourceType::Script,
      SourceType::PARCEL_SOURCE_TYPE_SCRIPT,
    ),
  ];
  for (core, abi) in source_type_cases {
    let target = CoreTarget {
      source_type: core,
      ..Default::default()
    };
    assert_eq!(parcel_target_get_source_type(target_handle(&target)), abi);
    assert_eq!(CoreSourceType::from(abi), core);
  }

  let target = target_fixture();
  let handle = target_handle(&target);
  assert_eq!(parcel_target_get_env_flags(handle), target.flags.bits());
  assert_eq!(
    string_output(|buffer| parcel_target_get_public_url(buffer, handle)).as_deref(),
    Some("/assets")
  );
  assert_eq!(
    string_output(|buffer| parcel_target_get_dist_dir(buffer, handle, 0)).as_deref(),
    Some("/project/dist")
  );
  parcel_target_get_public_url(ptr::null_mut(), handle);
  parcel_target_get_dist_dir(ptr::null_mut(), handle, 0);
}

#[test]
fn dependency_accessors_return_values_and_map_every_enum_variant() {
  let target = target_fixture();
  let dependency = dependency_fixture(target.clone());
  let handle = dependency_handle(&dependency);

  assert_eq!(
    string_output(|buffer| parcel_dep_get_specifier(buffer, handle)).as_deref(),
    Some("./dependency.js")
  );
  assert_eq!(parcel_dep_get_flags(handle), dependency.flags.bits());
  assert_eq!(
    parcel_dep_get_conditions(handle),
    dependency.conditions.bits()
  );
  assert_eq!(
    string_output(|buffer| parcel_dep_get_source_path(buffer, handle, 0)).as_deref(),
    Some("/project/src/source.js")
  );
  assert_eq!(
    string_output(|buffer| parcel_dep_get_resolve_from(buffer, handle, 0)).as_deref(),
    Some("/project/src/resolve-from.js")
  );
  assert_eq!(
    parcel_dep_get_target(handle),
    Arc::as_ptr(&target) as Target
  );

  let specifier_cases = [
    (CoreSpecifierType::Esm, SpecifierType::PARCEL_SPECIFIER_ESM),
    (
      CoreSpecifierType::Commonjs,
      SpecifierType::PARCEL_SPECIFIER_COMMONJS,
    ),
    (CoreSpecifierType::Url, SpecifierType::PARCEL_SPECIFIER_URL),
    (
      CoreSpecifierType::Custom,
      SpecifierType::PARCEL_SPECIFIER_CUSTOM,
    ),
  ];
  for (core, abi) in specifier_cases {
    let mut dependency = dependency_fixture(target.clone());
    dependency.specifier_type = core;
    assert_eq!(
      parcel_dep_get_specifier_type(dependency_handle(&dependency)),
      abi
    );
    assert_eq!(CoreSpecifierType::from(abi), core);
  }

  let priority_cases = [
    (CorePriority::Sync, Priority::PARCEL_PRIORITY_SYNC),
    (CorePriority::Parallel, Priority::PARCEL_PRIORITY_PARALLEL),
    (CorePriority::Lazy, Priority::PARCEL_PRIORITY_LAZY),
  ];
  for (core, abi) in priority_cases {
    let mut dependency = dependency_fixture(target.clone());
    dependency.priority = core;
    assert_eq!(parcel_dep_get_priority(dependency_handle(&dependency)), abi);
    assert_eq!(CorePriority::from(abi), core);
  }

  let behavior_cases = [
    (
      CoreBundleBehavior::None,
      BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE,
    ),
    (
      CoreBundleBehavior::Inline,
      BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_INLINE,
    ),
    (
      CoreBundleBehavior::Isolated,
      BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_ISOLATED,
    ),
  ];
  for (core, abi) in behavior_cases {
    let mut dependency = dependency_fixture(target.clone());
    dependency.bundle_behavior = core;
    assert_eq!(
      parcel_dep_get_bundle_behavior(dependency_handle(&dependency)),
      abi
    );
    assert_eq!(CoreBundleBehavior::from(abi), core);
  }

  let mut fallback = dependency_fixture(target.clone());
  fallback.resolve_from = None;
  assert_eq!(
    string_output(|buffer| parcel_dep_get_resolve_from(buffer, dependency_handle(&fallback), 0))
      .as_deref(),
    Some("/project/src/source.js")
  );
  fallback.loc = None;
  assert!(
    string_output(|buffer| parcel_dep_get_source_path(buffer, dependency_handle(&fallback), 0))
      .is_none()
  );
  assert!(
    string_output(|buffer| parcel_dep_get_resolve_from(buffer, dependency_handle(&fallback), 0))
      .is_none()
  );

  let mut asset = asset_fixture(target);
  asset.dependencies.push(dependency);
  let asset_handle = asset_handle(&asset);
  assert_eq!(parcel_asset_get_dependency_count(asset_handle), 1);
  assert_eq!(
    parcel_asset_get_dependency(asset_handle, 0),
    dependency_handle(&asset.dependencies[0])
  );
  assert_eq!(parcel_asset_get_dependency(asset_handle, 1), 0);
  assert_eq!(parcel_asset_get_dependency_count(0), 0);
  assert_eq!(parcel_asset_get_dependency(0, 0), 0);
  parcel_dep_get_specifier(ptr::null_mut(), handle);
  parcel_dep_get_source_path(ptr::null_mut(), handle, 0);
  parcel_dep_get_resolve_from(ptr::null_mut(), handle, 0);
}

#[test]
fn bundle_accessors_return_fields_urls_indices_and_fallbacks() {
  let target = target_fixture();
  let bundle = bundle_fixture(target.clone(), Some("/project/dist/chunks/app.js"));
  let mut from = bundle_fixture(target.clone(), Some("/project/dist/index.js"));
  from.id = 1;
  let handle = bundle_handle(&bundle);
  let from_handle = bundle_handle(&from);

  assert_eq!(
    string_output(|buffer| parcel_bundle_get_type(buffer, handle)).as_deref(),
    Some("js")
  );
  assert_eq!(
    parcel_bundle_get_target(handle),
    Arc::as_ptr(&target) as Target
  );
  assert_eq!(
    parcel_bundle_get_bundle_behavior(handle),
    BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_INLINE
  );
  assert_eq!(parcel_bundle_get_flags(handle), bundle.flags.bits());
  assert_eq!(
    string_output(|buffer| parcel_bundle_get_dist_path(buffer, handle)).as_deref(),
    Some("/project/dist/chunks/app.js")
  );
  assert_eq!(parcel_bundle_get_asset_count(handle), 2);
  assert_eq!(parcel_bundle_get_asset(handle, 0), 2);
  assert_eq!(parcel_bundle_get_asset(handle, 1), 5);
  assert_eq!(
    parcel_bundle_get_asset(handle, 2),
    PARCEL_INVALID_ASSET_INDEX
  );
  assert_eq!(parcel_bundle_get_entry_asset_count(handle), 1);
  assert_eq!(parcel_bundle_get_entry_asset(handle, 0), 5);
  assert_eq!(
    parcel_bundle_get_entry_asset(handle, 1),
    PARCEL_INVALID_ASSET_INDEX
  );
  assert_eq!(parcel_bundle_get_main_entry_asset(handle), 5);
  assert_eq!(
    string_output(|buffer| parcel_bundle_get_name(buffer, handle)).as_deref(),
    Some(bundle.name().as_str())
  );
  assert_eq!(
    string_output(|buffer| parcel_bundle_get_absolute_url(buffer, handle)).as_deref(),
    Some(bundle.absolute_url().as_str())
  );
  assert_eq!(
    string_output(|buffer| parcel_bundle_get_relative_url(buffer, handle, from_handle)).as_deref(),
    bundle.relative_url(&from).as_deref()
  );
  assert_eq!(
    string_output(|buffer| parcel_bundle_get_relative_specifier(buffer, handle, from_handle))
      .as_deref(),
    bundle.relative_specifier(&from).as_deref()
  );
  assert_eq!(
    string_output(|buffer| parcel_bundle_get_stable_key(buffer, handle)).as_deref(),
    Some("chunks/app.js")
  );
  assert_eq!(
    string_output(|buffer| parcel_bundle_get_hash_reference(buffer, handle)),
    Some(bundle.hash_reference())
  );

  // While `from` is being packaged, only the bundles it declared are available.
  from.begin_packaging(vec![]);
  assert!(
    string_output(|buffer| parcel_bundle_get_relative_url(buffer, handle, from_handle)).is_none()
  );
  assert!(
    string_output(|buffer| parcel_bundle_get_relative_specifier(buffer, handle, from_handle))
      .is_none()
  );
  from.begin_packaging(vec![bundle.id]);
  assert_eq!(
    string_output(|buffer| parcel_bundle_get_relative_url(buffer, handle, from_handle)).as_deref(),
    Some("chunks/app.js")
  );
  from.end_packaging();

  // A pending bundle's name is unavailable until its final path is set.
  let pending = bundle_fixture(target.clone(), Some("/project/dist/pending-template.js"));
  let pending_handle = bundle_handle(&pending);
  pending.name_state.mark_pending();
  assert!(string_output(|buffer| parcel_bundle_get_name(buffer, pending_handle)).is_none());
  assert!(string_output(|buffer| parcel_bundle_get_absolute_url(buffer, pending_handle)).is_none());
  assert!(
    string_output(|buffer| parcel_bundle_get_relative_url(buffer, pending_handle, from_handle))
      .is_none()
  );
  assert_eq!(
    string_output(|buffer| parcel_bundle_get_stable_key(buffer, pending_handle)).as_deref(),
    Some("pending-template.js")
  );
  pending.set_final_path(path("/project/dist/pending-final.js"));
  assert_eq!(
    string_output(|buffer| parcel_bundle_get_name(buffer, pending_handle)).as_deref(),
    Some("pending-final.js")
  );
  assert_eq!(
    string_output(|buffer| parcel_bundle_get_dist_path(buffer, pending_handle)).as_deref(),
    Some("/project/dist/pending-final.js")
  );

  let behavior_cases = [
    (
      CoreBundleBehavior::None,
      BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE,
    ),
    (
      CoreBundleBehavior::Inline,
      BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_INLINE,
    ),
    (
      CoreBundleBehavior::Isolated,
      BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_ISOLATED,
    ),
  ];
  for (core, abi) in behavior_cases {
    let mut bundle = bundle_fixture(target.clone(), None);
    bundle.bundle_behavior = core;
    assert_eq!(
      parcel_bundle_get_bundle_behavior(bundle_handle(&bundle)),
      abi
    );
    assert_eq!(CoreBundleBehavior::from(abi), core);
  }

  let mut unnamed = bundle_fixture(target, None);
  unnamed.main_entry_asset = None;
  let unnamed_handle = bundle_handle(&unnamed);
  assert!(string_output(|buffer| parcel_bundle_get_dist_path(buffer, unnamed_handle)).is_none());
  assert!(string_output(|buffer| parcel_bundle_get_name(buffer, unnamed_handle)).is_none());
  assert!(string_output(|buffer| parcel_bundle_get_absolute_url(buffer, unnamed_handle)).is_none());
  assert!(string_output(|buffer| parcel_bundle_get_stable_key(buffer, unnamed_handle)).is_none());
  assert!(
    string_output(|buffer| parcel_bundle_get_relative_url(buffer, unnamed_handle, from_handle))
      .is_none()
  );
  assert!(
    string_output(|buffer| {
      parcel_bundle_get_relative_specifier(buffer, handle, unnamed_handle)
    })
    .is_none()
  );
  assert_eq!(
    parcel_bundle_get_main_entry_asset(unnamed_handle),
    PARCEL_INVALID_ASSET_INDEX
  );

  assert_eq!(parcel_bundle_get_target(0), 0);
  assert_eq!(
    parcel_bundle_get_bundle_behavior(0),
    BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE
  );
  assert_eq!(parcel_bundle_get_flags(0), 0);
  assert_eq!(parcel_bundle_get_asset_count(0), 0);
  assert_eq!(parcel_bundle_get_entry_asset_count(0), 0);
  assert_eq!(parcel_bundle_get_asset(0, 0), PARCEL_INVALID_ASSET_INDEX);
  assert_eq!(
    parcel_bundle_get_entry_asset(0, 0),
    PARCEL_INVALID_ASSET_INDEX
  );
  assert_eq!(
    parcel_bundle_get_main_entry_asset(0),
    PARCEL_INVALID_ASSET_INDEX
  );
  assert!(string_output(|buffer| parcel_bundle_get_type(buffer, 0)).is_none());
  assert!(string_output(|buffer| parcel_bundle_get_dist_path(buffer, 0)).is_none());
  assert!(string_output(|buffer| parcel_bundle_get_name(buffer, 0)).is_none());
  assert!(string_output(|buffer| parcel_bundle_get_absolute_url(buffer, 0)).is_none());
  assert!(string_output(|buffer| parcel_bundle_get_stable_key(buffer, 0)).is_none());
  assert!(string_output(|buffer| parcel_bundle_get_hash_reference(buffer, 0)).is_none());
  assert!(string_output(|buffer| parcel_bundle_get_relative_url(buffer, 0, from_handle)).is_none());
  assert!(
    string_output(|buffer| parcel_bundle_get_relative_specifier(buffer, handle, 0)).is_none()
  );
}

#[test]
fn bundle_graph_accessors_cover_every_dependency_resolution() {
  let target = target_fixture();
  let mut source = asset_fixture(target.clone());
  let mut resolved = asset_fixture(target.clone());
  resolved.loc.url = SourceUrl::from_path(&path("/project/src/resolved.js"));

  let deferred_request = Arc::new(AssetRequest {
    loc: SourceLocation {
      url: SourceUrl::from_path(&path("/project/src/deferred.js")),
      ..Default::default()
    },
    ty: AssetType::Js,
    pipeline: None,
    target: target.clone(),
    content: Arc::new(BufferContent::new(Vec::new())),
    side_effects: true,
    unique_key: None,
  });

  for resolution in [
    DependencyResolution::None,
    DependencyResolution::Deferred(deferred_request),
    DependencyResolution::External,
    DependencyResolution::Excluded,
    DependencyResolution::Asset(AssetNodeIndex::from_index(1)),
    DependencyResolution::None,
  ] {
    let mut dependency = dependency_fixture(target.clone());
    dependency.resolution = resolution;
    source.dependencies.push(dependency);
  }

  let assets = vec![source, resolved];
  let bundle = bundle_fixture(target, Some("/project/dist/app.js"));
  let mut bundle_resolutions = HashMap::new();
  bundle_resolutions.insert(
    DependencyId {
      asset: CoreAssetIndex(0),
      dependency: 5,
    },
    parcel_core::BundleGraphDependencyResolution::Bundle {
      bundle_index: 0,
      asset_index: CoreAssetIndex(0),
    },
  );
  let graph = CoreBundleGraph::new(
    AssetGraph {
      asset_nodes: Cow::Owned(
        assets
          .iter()
          .enumerate()
          .map(|(index, asset)| AssetNode::from_asset(CoreAssetIndex::from_index(index), asset))
          .collect(),
      ),
      assets: Cow::Owned(assets),
      entries: Cow::Owned(Vec::new()),
    },
    vec![bundle],
    bundle_resolutions,
    path("/project"),
  );
  let handle = &graph as *const CoreBundleGraph as BundleGraph;

  assert_eq!(parcel_bundle_graph_get_asset_count(handle), 2);
  assert_eq!(
    parcel_bundle_graph_get_asset(handle, 0),
    &graph.asset_graph.assets[0] as *const CoreAsset as Asset
  );
  assert_eq!(parcel_bundle_graph_get_asset(handle, 2), 0);
  assert_eq!(parcel_bundle_graph_get_bundle_count(handle), 1);
  assert_eq!(
    parcel_bundle_graph_get_bundle(handle, 0),
    &graph.bundles[0] as *const CoreBundle as Bundle
  );
  assert_eq!(parcel_bundle_graph_get_bundle(handle, 1), 0);

  let expected = [
    BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_NONE,
    BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_DEFERRED,
    BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_EXTERNAL,
    BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_EXCLUDED,
    BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_ASSET,
    BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_BUNDLE,
  ];
  for (dependency_index, resolution_type) in expected.into_iter().enumerate() {
    let result = parcel_bundle_graph_get_dependency_resolution(handle, 0, dependency_index);
    assert_eq!(result.resolution_type, resolution_type);
    if dependency_index == 4 {
      assert_eq!(result.asset, 1);
    }
    if dependency_index == 5 {
      assert_eq!(result.bundle, 0);
    }
  }

  assert_eq!(parcel_bundle_graph_get_asset_count(0), 0);
  assert_eq!(parcel_bundle_graph_get_asset(0, 0), 0);
  assert_eq!(parcel_bundle_graph_get_bundle_count(0), 0);
  assert_eq!(parcel_bundle_graph_get_bundle(0, 0), 0);
  assert_eq!(
    parcel_bundle_graph_get_dependency_resolution(0, 0, 0).resolution_type,
    BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_INVALID
  );
  assert_eq!(
    parcel_bundle_graph_get_dependency_resolution(handle, 2, 0).resolution_type,
    BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_INVALID
  );
  assert_eq!(
    parcel_bundle_graph_get_dependency_resolution(handle, 0, 6).resolution_type,
    BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_INVALID
  );
}

#[test]
fn options_accessors_return_project_root_and_environment_values() {
  let mut options = ParcelOptions {
    project_root: path("/project"),
    ..Default::default()
  };
  options.env.insert("NODE_ENV".into(), "test".into());
  let context = OptionsContext::new(&options);
  let handle = context.handle();

  assert_eq!(
    string_output(|buffer| parcel_options_get_project_root(buffer, handle)).as_deref(),
    Some("/project")
  );
  assert_eq!(
    string_output(|buffer| {
      parcel_options_get_env(buffer, handle, b"NODE_ENV".as_ptr(), b"NODE_ENV".len())
    })
    .as_deref(),
    Some("test")
  );
  assert!(
    string_output(|buffer| {
      parcel_options_get_env(buffer, handle, b"MISSING".as_ptr(), b"MISSING".len())
    })
    .is_none()
  );
  assert!(string_output(|buffer| parcel_options_get_env(buffer, handle, ptr::null(), 0)).is_none());
  parcel_options_get_project_root(ptr::null_mut(), handle);
}

// ── Reporter events ──────────────────────────────────────────────────────────

fn diagnostics_fixture() -> Vec<parcel_core::Diagnostic> {
  vec![
    parcel_core::Diagnostic {
      message: "something went wrong".into(),
      origin: Some("@acme/plugin".into()),
      hints: vec!["try turning it off and on again".into(), "or don't".into()],
      severity: parcel_core::DiagnosticSeverity::Warning,
      ..parcel_core::Diagnostic::from_message(String::new())
    },
    parcel_core::Diagnostic::from_message("and so did this".into()),
  ]
}

/// Builds a handle the way `CPlugin::report` does, and runs `call` against it.
fn with_diagnostics(diagnostics: &[parcel_core::Diagnostic], call: impl FnOnce(Diagnostics)) {
  let view = crate::diagnostics::DiagnosticsView { diagnostics };
  call(&view as *const crate::diagnostics::DiagnosticsView as Diagnostics);
}

#[test]
fn diagnostics_accessors_read_the_list() {
  let diagnostics = diagnostics_fixture();
  with_diagnostics(&diagnostics, |handle| {
    assert_eq!(parcel_diagnostics_get_count(handle), 2);

    assert_eq!(
      string_output(|buffer| parcel_diagnostic_get_message(buffer, handle, 0)).as_deref(),
      Some("something went wrong")
    );
    assert_eq!(
      parcel_diagnostic_get_severity(handle, 0),
      DiagnosticSeverity::PARCEL_SEVERITY_WARNING
    );
    assert_eq!(
      string_output(|buffer| parcel_diagnostic_get_origin(buffer, handle, 0)).as_deref(),
      Some("@acme/plugin")
    );

    assert_eq!(parcel_diagnostic_get_hint_count(handle, 0), 2);
    assert_eq!(
      string_output(|buffer| parcel_diagnostic_get_hint(buffer, handle, 0, 1)).as_deref(),
      Some("or don't")
    );

    // The second diagnostic has neither an origin nor hints.
    assert_eq!(
      string_output(|buffer| parcel_diagnostic_get_message(buffer, handle, 1)).as_deref(),
      Some("and so did this")
    );
    assert_eq!(
      string_output(|buffer| parcel_diagnostic_get_origin(buffer, handle, 1)),
      None
    );
    assert_eq!(parcel_diagnostic_get_hint_count(handle, 1), 0);
  });
}

#[test]
fn diagnostics_accessors_tolerate_bad_handles_and_indices() {
  // A null handle is what an event with no diagnostics carries.
  assert_eq!(parcel_diagnostics_get_count(0), 0);
  assert_eq!(parcel_diagnostic_get_hint_count(0, 0), 0);
  assert_eq!(
    string_output(|buffer| parcel_diagnostic_get_message(buffer, 0, 0)),
    None
  );
  assert_eq!(
    parcel_diagnostic_get_severity(0, 0),
    DiagnosticSeverity::PARCEL_SEVERITY_ERROR
  );

  let diagnostics = diagnostics_fixture();
  with_diagnostics(&diagnostics, |handle| {
    assert_eq!(
      string_output(|buffer| parcel_diagnostic_get_message(buffer, handle, 99)),
      None
    );
    assert_eq!(
      string_output(|buffer| parcel_diagnostic_get_hint(buffer, handle, 0, 99)),
      None
    );
  });
}

/// Collects what plugins log through the options handle.
struct LogRecorder {
  events: Arc<std::sync::Mutex<Vec<String>>>,
}

impl parcel_core::Reporter for LogRecorder {
  fn report(
    &self,
    event: &parcel_core::ReporterEvent,
    _options: &ParcelOptions,
  ) -> Result<(), parcel_core::DiagnosticList> {
    if let parcel_core::ReporterEvent::Log(log) = event {
      let message = match log.message {
        parcel_core::LogMessage::Text(text) => text.to_owned(),
        parcel_core::LogMessage::Diagnostics(diagnostics) => diagnostics
          .iter()
          .map(|d| d.message.clone())
          .collect::<Vec<_>>()
          .join(", "),
      };
      self
        .events
        .lock()
        .unwrap()
        .push(format!("{}: {}", log.level, message));
    }
    Ok(())
  }
}

fn options_with_recorder() -> (Arc<ParcelOptions>, Arc<std::sync::Mutex<Vec<String>>>) {
  let events = Arc::new(std::sync::Mutex::new(Vec::new()));
  let reporters = parcel_core::Reporters::new(
    vec![Arc::new(LogRecorder {
      events: events.clone(),
    })],
    parcel_core::LogLevel::Verbose,
  );
  let options = Arc::new(ParcelOptions {
    project_root: path("/project"),
    reporters: reporters.clone(),
    ..Default::default()
  });
  reporters.attach(Arc::downgrade(&options));
  (options, events)
}

#[test]
fn plugins_log_messages_through_the_options_handle() {
  let (options, events) = options_with_recorder();
  let context = OptionsContext::new(&options);
  let handle = context.handle();

  let message = b"a message from a plugin";
  parcel_options_log(
    handle,
    LogLevel::PARCEL_LOG_WARN,
    message.as_ptr(),
    message.len(),
  );

  assert_eq!(*events.lock().unwrap(), ["warn: a message from a plugin"]);
}

#[test]
fn plugins_log_diagnostics_without_giving_up_their_buffers() {
  let (options, events) = options_with_recorder();
  let context = OptionsContext::new(&options);
  let handle = context.handle();

  let message = b"a warning worth surfacing";
  let mut diagnostic = Diagnostic {
    message: parcel_buffer_alloc(message.as_ptr(), message.len()),
    severity: DiagnosticSeverity::PARCEL_SEVERITY_WARNING,
    ..Default::default()
  };

  parcel_options_log_diagnostic(handle, &diagnostic);

  // The severity picked the log level, rather than the caller naming both.
  assert_eq!(*events.lock().unwrap(), ["warn: a warning worth surfacing"]);

  // The host copied rather than taking ownership, so the buffer is still the
  // plugin's to read and to free.
  assert_eq!(
    unsafe { std::slice::from_raw_parts(diagnostic.message.data, diagnostic.message.len) },
    message
  );
  parcel_free_buffer(&mut diagnostic.message);
}

/// A project in memory, read through a tracker so tests can see what was recorded.
fn tracked_project() -> (ParcelOptions, Arc<TrackingFileSystem>) {
  let memory = MemoryFileSystem::new();
  let files: [(&str, &str); 4] = [
    ("/project/src/index.scss", "a { color: red }"),
    (
      "/project/node_modules/pkg/package.json",
      r#"{"name": "pkg", "exports": {"sass": "./style.scss", "default": "./index.js"}}"#,
    ),
    ("/project/node_modules/pkg/style.scss", ""),
    ("/project/node_modules/pkg/index.js", ""),
  ];
  for (file, contents) in files {
    let file = path(file);
    memory.create_dir_all(file.parent().unwrap()).unwrap();
    memory.write(file, contents.as_bytes()).unwrap();
  }

  let options = ParcelOptions {
    project_root: path("/project"),
    ..Default::default()
  };
  (options, Arc::new(TrackingFileSystem::new(Arc::new(memory))))
}

fn read_file(handle: Options, file: &str) -> (IoStatus, Option<String>) {
  let mut status = IoStatus::PARCEL_IO_ERROR;
  let output = string_output(|buffer| {
    status = parcel_fs_read_file(buffer, handle, file.as_ptr(), file.len());
  });
  (status, output)
}

#[test]
fn fs_reads_are_recorded_as_invalidations() {
  let (options, fs) = tracked_project();
  let dyn_fs: Arc<dyn FileSystem> = fs.clone();
  let plugin = PluginContext::new(&options, &dyn_fs);
  let context = OptionsContext::with_plugin(&plugin);
  let handle = context.handle();

  assert_eq!(
    read_file(handle, "/project/src/index.scss"),
    (IoStatus::PARCEL_IO_OK, Some("a { color: red }".into()))
  );
  assert_eq!(
    read_file(handle, "/project/src/missing.scss"),
    (IoStatus::PARCEL_IO_NOT_FOUND, None)
  );

  let invalidations = fs.take();
  assert_eq!(
    invalidations.invalidate_on_file_change,
    [path("/project/src/index.scss")]
  );
  assert!(matches!(
    invalidations.invalidate_on_file_create.as_slice(),
    [FileCreateInvalidation::Path(p)] if *p == path("/project/src/missing.scss")
  ));
}

#[test]
fn fs_reports_kinds_and_canonical_paths() {
  let (options, fs) = tracked_project();
  let dyn_fs: Arc<dyn FileSystem> = fs.clone();
  let plugin = PluginContext::new(&options, &dyn_fs);
  let context = OptionsContext::with_plugin(&plugin);
  let handle = context.handle();
  let kind = |file: &str| parcel_fs_get_kind(handle, file.as_ptr(), file.len());

  assert_eq!(
    kind("/project/src/index.scss"),
    FileKind::PARCEL_FILE_KIND_FILE as FileKindFFI
  );
  assert_eq!(
    kind("/project/src"),
    FileKind::PARCEL_FILE_KIND_DIR as FileKindFFI
  );
  assert_eq!(kind("/project/missing"), 0);

  let file = "/project/src/../src/index.scss";
  let mut status = IoStatus::PARCEL_IO_ERROR;
  let canonical = string_output(|buffer| {
    status = parcel_fs_canonicalize(buffer, handle, file.as_ptr(), file.len());
  });
  assert_eq!(status, IoStatus::PARCEL_IO_OK);
  assert_eq!(canonical.as_deref(), Some("/project/src/index.scss"));
}

/// Resolves `pkg` to a file next to the importer and records the dependency it was given, so
/// tests can check what reached the resolver chain.
#[derive(Default)]
struct RecordingResolver {
  seen: std::sync::Mutex<Vec<CoreDependency>>,
}

impl Resolver for RecordingResolver {
  fn resolve(
    &self,
    dep: &CoreDependency,
    specifier: &str,
    _pipeline: Option<&str>,
    ctx: &PluginContext,
  ) -> Result<DependencyResolution, DiagnosticList> {
    self.seen.lock().unwrap().push(dep.clone());
    let from = dep.resolve_from.as_ref().unwrap().to_file_path()?;
    match specifier {
      "pkg" => {
        let file = from.parent().unwrap().child("pkg.scss");
        // Probed through the context's file system, as a real resolver would.
        ctx.fs.kind(file);
        Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
          loc: SourceLocation {
            url: SourceUrl::from_path(&file),
            ..Default::default()
          },
          ty: AssetType::Scss,
          pipeline: Some("styles".into()),
          target: dep.target.clone(),
          content: Arc::new(BufferContent::new_string(String::new())),
          side_effects: false,
          unique_key: None,
        })))
      }
      "excluded" => Ok(DependencyResolution::Excluded),
      _ => Ok(DependencyResolution::None),
    }
  }
}

fn asset_resolve(
  asset: &CoreAsset,
  handle: Options,
  specifier: &str,
  from: &str,
) -> Option<(ResolutionType, Option<String>, Option<String>)> {
  let dep = DependencyOptions {
    specifier: specifier.as_ptr(),
    specifier_len: specifier.len(),
    specifier_type: SpecifierType::PARCEL_SPECIFIER_ESM,
    priority: Priority::PARCEL_PRIORITY_SYNC,
    bundle_behavior: BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE,
    flags: 0,
    conditions: CoreExportsCondition::SASS.bits(),
  };
  let mut result = ResolveResult {
    resolution_type: ResolutionType::PARCEL_RESOLUTION_NONE,
    file_path: Buffer::default(),
    pipeline: Buffer::default(),
  };
  let resolved = parcel_asset_resolve(
    asset as *const CoreAsset as Asset,
    handle,
    &dep,
    from.as_ptr(),
    from.len(),
    &mut result,
  );
  let take = |buffer: &mut Buffer| {
    if buffer.data.is_null() {
      return None;
    }
    let bytes = unsafe { std::slice::from_raw_parts(buffer.data, buffer.len).to_vec() };
    parcel_free_buffer(buffer);
    Some(String::from_utf8(bytes).unwrap())
  };
  resolved.then(|| {
    (
      result.resolution_type,
      take(&mut result.file_path),
      take(&mut result.pipeline),
    )
  })
}

#[test]
fn asset_resolve_runs_the_resolver_chain() {
  let (options, fs) = tracked_project();
  let dyn_fs: Arc<dyn FileSystem> = fs.clone();
  let recorder = Arc::new(RecordingResolver::default());
  let resolvers: Vec<Arc<dyn Resolver>> = vec![recorder.clone()];
  let transformers = Default::default();
  let plugin = PluginContext::new(&options, &dyn_fs).with_resolvers(&resolvers, &transformers);
  let context = OptionsContext::with_plugin(&plugin);
  let asset = asset_fixture(target_fixture());

  // An empty `from` resolves from the asset itself.
  assert_eq!(
    asset_resolve(&asset, context.handle(), "pkg", ""),
    Some((
      ResolutionType::PARCEL_RESOLUTION_FILE_PATH,
      Some("/project/src/pkg.scss".into()),
      Some("styles".into())
    ))
  );
  // An import inside a file the asset pulled in resolves from that file.
  assert_eq!(
    asset_resolve(
      &asset,
      context.handle(),
      "pkg",
      "/project/lib/nested/_partial.scss"
    ),
    Some((
      ResolutionType::PARCEL_RESOLUTION_FILE_PATH,
      Some("/project/lib/nested/pkg.scss".into()),
      Some("styles".into())
    ))
  );
  assert_eq!(
    asset_resolve(&asset, context.handle(), "excluded", ""),
    Some((ResolutionType::PARCEL_RESOLUTION_EXCLUDED, None, None))
  );
  // Nothing in the chain resolves it.
  assert_eq!(asset_resolve(&asset, context.handle(), "missing", ""), None);

  let seen = recorder.seen.lock().unwrap();
  assert!(Arc::ptr_eq(&seen[0].target, &asset.target));
  assert_eq!(seen[0].conditions, CoreExportsCondition::SASS);
  assert_eq!(
    seen[1].resolve_from,
    Some(SourceUrl::from_path(&path(
      "/project/lib/nested/_partial.scss"
    )))
  );

  // Probes made by resolvers invalidate the asset like the plugin's own reads.
  assert!(
    fs.take()
      .invalidate_on_file_create
      .iter()
      .any(|i| matches!(i, FileCreateInvalidation::Path(p) if *p == path("/project/src/pkg.scss")))
  );
}

#[test]
fn fs_is_unavailable_outside_transform_and_resolve() {
  let (options, _) = tracked_project();
  let context = OptionsContext::new(&options);
  let handle = context.handle();
  let file = "/project/src/index.scss";

  let (status, message) = read_file(handle, file);
  assert_eq!(status, IoStatus::PARCEL_IO_ERROR);
  assert!(message.unwrap().contains("only available"));
  assert_eq!(parcel_fs_get_kind(handle, file.as_ptr(), file.len()), 0);
  let asset = asset_fixture(target_fixture());
  assert_eq!(asset_resolve(&asset, handle, "pkg", ""), None);
}

#[test]
fn fs_rejects_relative_paths() {
  let (options, fs) = tracked_project();
  let dyn_fs: Arc<dyn FileSystem> = fs.clone();
  let plugin = PluginContext::new(&options, &dyn_fs);
  let context = OptionsContext::with_plugin(&plugin);
  let (status, message) = read_file(context.handle(), "src/index.scss");
  assert_eq!(status, IoStatus::PARCEL_IO_ERROR);
  assert_eq!(message.as_deref(), Some("Expected an absolute path"));
}
