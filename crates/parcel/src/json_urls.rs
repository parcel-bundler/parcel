use std::sync::Arc;

use parcel_core::{
  Asset, BufferContent, Bundle, BundleBehavior, BundleGraph, BundleGraphDependencyResolution,
  Content, ContentType, Dependency, DependencyFlags, DependencyResolution, Diagnostic,
  DiagnosticList, ExportsCondition, ImportType, ParcelOptions, Priority, SourceLocation,
  SpecifierType,
};
use serde_json::Value;

/// Parsed JSON and the dependency index for each URL-bearing value. Keeping pointers rather
/// than placeholders means packaging only changes URL fields, even when other fields contain
/// the same string.
pub struct JsonUrlContent {
  pub json: Value,
  pub urls: Vec<(String, usize)>,
  pub source_size: usize,
}

impl JsonUrlContent {
  pub fn add_url(&mut self, asset: &mut Asset, pointer: String, loc: Option<SourceLocation>) {
    let specifier = self.json.pointer(&pointer).unwrap().as_str().unwrap();
    self.urls.push((pointer, asset.dependencies.len()));
    asset.dependencies.push(Dependency {
      specifier: specifier.into(),
      specifier_type: SpecifierType::Url,
      priority: Priority::Lazy,
      bundle_behavior: BundleBehavior::None,
      import_type: ImportType::Url,
      flags: DependencyFlags::empty(),
      concurrent_group: 0,
      target: asset.target.clone(),
      loc,
      placeholder: None,
      resolve_from: Some(asset.loc.url.clone()),
      range: None,
      conditions: ExportsCondition::empty(),
      resolution: DependencyResolution::None,
    });
  }
}

impl Content for JsonUrlContent {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    Ok(serde_json::to_vec(&self.json)?)
  }

  fn estimate_size(&self) -> Result<usize, Diagnostic> {
    Ok(self.source_size)
  }

  fn ty(&self) -> ContentType {
    parcel_core::content_type!("JsonUrlContent")
  }

  fn eq(&self, other: &dyn Content) -> bool {
    other
      .downcast_ref::<Self>()
      .is_some_and(|other| self.urls == other.urls && self.read() == other.read())
  }

  fn bundle_dependencies(&self, bundle_graph: &BundleGraph, bundle: &Bundle) -> Vec<usize> {
    bundle_graph.bundle_dependency_targets(bundle).collect()
  }

  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    _options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    assert_eq!(bundle.assets.len(), 1);
    let asset_index = bundle.assets[0];
    let mut json = self.json.clone();
    for (pointer, dependency_index) in &self.urls {
      if let BundleGraphDependencyResolution::Bundle { bundle_index, .. } =
        bundle_graph.dependency_resolution(asset_index, *dependency_index)
      {
        let target = &bundle_graph.bundles[bundle_index as usize];
        let mut url = if target.bundle_behavior == BundleBehavior::Inline {
          get_inline_bundle_content(bundle_index as usize)?
            .read_string()?
            .into_owned()
        } else {
          target.absolute_url()
        };
        if target.bundle_behavior != BundleBehavior::Inline {
          let dependency =
            &bundle_graph.asset_graph.asset(asset_index).dependencies[*dependency_index];
          if let Some((_, fragment)) = dependency.specifier.split_once('#') {
            url.push('#');
            url.push_str(fragment);
          }
        }
        *json.pointer_mut(pointer).unwrap() = Value::String(url);
      }
    }
    Ok(Arc::new(BufferContent::new(serde_json::to_vec(&json)?)))
  }
}
