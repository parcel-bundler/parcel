use parcel_plugin::{
  Asset, AssetContent, Bundle, BundleGraph, ContentBuffer, Diagnostic, Options, Plugin,
  register_plugin,
};

/// An intentionally small stand-in for an AST. Parcel retains this Rust value
/// as the asset content until the package callback runs.
struct UppercaseContent {
  source: String,
  words: Vec<String>,
}

impl AssetContent for UppercaseContent {
  const TYPE_ID: [u8; 16] = parcel_plugin::type_id!("UppercaseContent");

  fn read(&self) -> Result<ContentBuffer, Diagnostic> {
    if self.source == "PANIC_READ" {
      panic!("example custom content read panic");
    }
    Ok(ContentBuffer::String(self.source.clone()))
  }

  fn package(
    &self,
    graph: &BundleGraph,
    bundle: &Bundle,
    _options: &Options,
  ) -> Result<ContentBuffer, Diagnostic> {
    if self.source == "PANIC_PACKAGE" {
      panic!("example custom content package panic");
    }

    let mut found_self = false;
    let mut dependency_count = 0;

    for asset in graph.assets() {
      for (dependency_index, _) in asset.dependencies().enumerate() {
        dependency_count += 1;
        let _ = graph.dependency_resolution(asset.index(), dependency_index);
      }

      if asset
        .custom_content::<UppercaseContent>()
        .is_some_and(|content| std::ptr::eq(content, self))
      {
        found_self = true;
      }
    }

    if !found_self {
      return Err(Diagnostic::new(
        "custom content was not accessible through BundleGraph",
      ));
    }

    let value = self.words.join(" ").to_uppercase();
    Ok(ContentBuffer::String(format!(
      "// rust-custom-content assets={} bundles={} dependencies={} type={}\nexport default {:?};\n",
      graph.asset_count(),
      graph.bundle_count(),
      dependency_count,
      bundle.asset_type(),
      value,
    )))
  }
}

struct CustomContentTransformer;

impl Plugin for CustomContentTransformer {
  fn new(_config: &[u8]) -> Result<Self, Diagnostic> {
    Ok(Self)
  }

  fn transform(&self, asset: &mut Asset, _options: &Options) -> Result<(), Diagnostic> {
    let source = asset.content().trim().to_owned();
    let words = source.split_whitespace().map(str::to_owned).collect();
    asset.set_custom_content(UppercaseContent { source, words });
    if asset
      .custom_content::<UppercaseContent>()
      .is_some_and(|content| content.source == "PANIC_READ")
    {
      // Changing type causes the normal JS transformer to request the custom
      // content's string representation, exercising the read callback.
      asset.set_type("js");
    }
    Ok(())
  }
}

register_plugin!(CustomContentTransformer);
