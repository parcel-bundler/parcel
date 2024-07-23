use parcel_core::types::{Priority, SpecifierType};

pub(crate) fn convert_priority(
  transformer_dependency: &parcel_js_swc_core::DependencyDescriptor,
) -> Priority {
  use parcel_js_swc_core::DependencyKind;

  match transformer_dependency.kind {
    DependencyKind::DynamicImport => Priority::Lazy,
    DependencyKind::WebWorker => Priority::Lazy,
    DependencyKind::ServiceWorker => Priority::Lazy,
    DependencyKind::Worklet => Priority::Lazy,
    DependencyKind::Url => Priority::Lazy,
    DependencyKind::Import => Priority::Sync,
    DependencyKind::Export => Priority::Sync,
    DependencyKind::Require => Priority::Sync,
    DependencyKind::File => Priority::Sync,
    DependencyKind::DeferredForDisplayTierImport => Priority::Tier,
    DependencyKind::DeferredTierImport => Priority::Tier,
  }
}

pub(crate) fn convert_specifier_type(
  transformer_dependency: &parcel_js_swc_core::DependencyDescriptor,
) -> SpecifierType {
  use parcel_js_swc_core::DependencyKind;

  match transformer_dependency.kind {
    DependencyKind::Require => SpecifierType::CommonJS,
    DependencyKind::Import => SpecifierType::Esm,
    DependencyKind::Export => SpecifierType::Esm,
    DependencyKind::DynamicImport => SpecifierType::Esm,
    DependencyKind::WebWorker => SpecifierType::Url,
    DependencyKind::ServiceWorker => SpecifierType::Url,
    DependencyKind::Worklet => SpecifierType::Url,
    DependencyKind::Url => SpecifierType::Url,
    DependencyKind::File => SpecifierType::Custom,
    DependencyKind::DeferredForDisplayTierImport => SpecifierType::Esm,
    DependencyKind::DeferredTierImport => SpecifierType::Esm,
  }
}

#[cfg(test)]
mod test {
  use crate::transformer::test_helpers::run_swc_core_transform;
  use parcel_js_swc_core::DependencyKind;

  use super::*;

  #[test]
  fn test_import_dependency_kind() {
    let dependency = get_last_dependency(
      r#"
      import {x} from 'other';
    "#,
    );
    assert_eq!(dependency.kind, DependencyKind::Import);
    assert_eq!(convert_priority(&dependency), Priority::Sync);
    assert_eq!(convert_specifier_type(&dependency), SpecifierType::Esm);
  }

  #[test]
  fn test_dynamic_import_dependency_kind() {
    let dependency = get_last_dependency(
      r#"
      const {x} = await import('other');
    "#,
    );
    assert_eq!(dependency.kind, DependencyKind::DynamicImport);
    assert_eq!(convert_priority(&dependency), Priority::Lazy);
    assert_eq!(convert_specifier_type(&dependency), SpecifierType::Esm);
  }

  #[test]
  fn test_export_dependency_kind() {
    let dependency = get_last_dependency(
      r#"
      export {x} from 'other';
    "#,
    );
    assert_eq!(dependency.kind, DependencyKind::Export);
    assert_eq!(convert_priority(&dependency), Priority::Sync);
    assert_eq!(convert_specifier_type(&dependency), SpecifierType::Esm);
  }

  #[test]
  fn test_require_dependency_kind() {
    let dependency = get_last_dependency(
      r#"
      const {x} = require('other');
    "#,
    );
    assert_eq!(dependency.kind, DependencyKind::Require);
    assert_eq!(convert_priority(&dependency), Priority::Sync);
    assert_eq!(convert_specifier_type(&dependency), SpecifierType::CommonJS);
  }

  #[test]
  fn test_worker_dependency_kind() {
    let dependency = get_last_dependency(
      r#"
      new Worker(new URL('other', import.meta.url), {type: 'module'});
    "#,
    );
    assert_eq!(dependency.kind, DependencyKind::WebWorker);
    assert_eq!(convert_priority(&dependency), Priority::Lazy);
    assert_eq!(convert_specifier_type(&dependency), SpecifierType::Url);
  }

  #[test]
  fn test_service_worker_dependency_kind() {
    let dependency = get_last_dependency(
      r#"
      navigator.serviceWorker.register(new URL('./dependency', import.meta.url), {type: 'module'});
    "#,
    );
    assert_eq!(dependency.kind, DependencyKind::ServiceWorker);
    assert_eq!(convert_priority(&dependency), Priority::Lazy);
    assert_eq!(convert_specifier_type(&dependency), SpecifierType::Url);
  }

  #[test]
  fn test_worklet_dependency_kind() {
    let dependency = get_last_dependency(
      r#"
      CSS.paintWorklet.addModule(new URL('other', import.meta.url));
    "#,
    );
    assert_eq!(dependency.kind, DependencyKind::Worklet);
    assert_eq!(convert_priority(&dependency), Priority::Lazy);
    assert_eq!(convert_specifier_type(&dependency), SpecifierType::Url);
  }

  #[test]
  fn test_url_dependency_kind() {
    let dependency = get_last_dependency(
      r#"
      let img = document.createElement('img');
      img.src = new URL('hero.jpg', import.meta.url);
      document.body.appendChild(img);
    "#,
    );
    assert_eq!(dependency.kind, DependencyKind::Url);
    assert_eq!(convert_priority(&dependency), Priority::Lazy);
    assert_eq!(convert_specifier_type(&dependency), SpecifierType::Url);
  }

  // This test-case can't be written right now because in order to parse inline-fs
  // declarations, parcel needs to canonicalize paths, meaning that it does not work
  // unless the source/project and read files exist on disk.
  //
  // Running this test at the moment will fail because the `import fs` will be returned
  // as the last dependency, since the InlineFS transformer failed to run.
  #[ignore]
  #[test]
  fn test_file_dependency_kind() {
    let dependency = get_last_dependency(
      r#"
      import fs from "fs";
      import path from "path";
      const data = fs.readFileSync(path.join(__dirname, "data.json"), "utf8");
    "#,
    );
    assert_eq!(dependency.kind, DependencyKind::File);
    assert_eq!(convert_priority(&dependency), Priority::Sync);
    assert_eq!(convert_specifier_type(&dependency), SpecifierType::Custom);
  }

  /// Run the SWC transformer and return the last dependency descriptor listed.
  fn get_last_dependency(source: &str) -> parcel_js_swc_core::DependencyDescriptor {
    let swc_output = run_swc_core_transform(source);
    swc_output.dependencies.last().unwrap().clone()
  }
}
