use std::{
  collections::{HashMap, HashSet},
  sync::Arc,
};

use parcel_core::{
  Asset, AssetType, BufferContent, Bundle, BundleBehavior, BundleGraph, Content,
  DependencyResolution, Diagnostic, DiagnosticList, OutputFormat, Packager, ParcelOptions,
  Transformer,
};
use parcel_html::{
  BundleReference, InlineBundle, PackageOptions, SerializableTendril, TransformOptions,
  package_html, transform_html,
};

pub struct HtmlTransformer {}

impl Transformer for HtmlTransformer {
  fn transform(&self, mut asset: Asset, _options: &ParcelOptions) -> Result<Asset, DiagnosticList> {
    let code = asset.content.read()?;
    let res = transform_html(TransformOptions {
      code,
      file_path: asset.loc.url.to_file_path().unwrap(),
      xml: asset.ty == AssetType::Xhtml,
      env: asset.env.clone(),
      hmr: false,
    });

    asset.bundle_behavior = BundleBehavior::Isolated;
    asset.content = Arc::new(BufferContent::new(res.code));
    asset.dependencies.extend(res.dependencies);

    Ok(asset)
  }
}

pub struct HtmlPackager {}

impl Packager for HtmlPackager {
  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
  ) -> Result<std::sync::Arc<dyn Content>, DiagnosticList> {
    assert_eq!(bundle.assets.len(), 1);

    let asset = bundle_graph.asset_graph.assets[bundle.assets[0]].expect_asset();

    let code = asset.content.read()?;

    let mut inline_bundles = HashMap::new();
    let mut referenced_bundles = HashSet::<usize>::new();
    for dep in &asset.dependencies {
      if let DependencyResolution::Bundle(b) = dep.resolution {
        let bundle = &bundle_graph.bundles[b as usize];
        let contents = if dep.bundle_behavior == BundleBehavior::Inline {
          String::from_utf8(get_inline_bundle_content(b as usize)?.read()?).unwrap()
        } else {
          bundle
            .name
            .as_ref()
            .unwrap()
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_owned()
        };

        inline_bundles.insert(
          SerializableTendril(dep.placeholder.clone().unwrap().into()),
          InlineBundle {
            contents: SerializableTendril(contents.into()),
            module: bundle.env.output_format == OutputFormat::Esmodule,
          },
        );

        referenced_bundles.extend(bundle.referenced_bundles.iter()); // TODO: should be recursive
      }
    }

    let mut bundles: Vec<BundleReference> = Vec::new();
    for reference in referenced_bundles {
      let bundle = &bundle_graph.bundles[reference];
      match &bundle.ty {
        AssetType::Js => {
          let src = bundle
            .name
            .as_ref()
            .unwrap()
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_owned();
          bundles.push(BundleReference::Script {
            src: SerializableTendril(src.into()),
            module: bundle.env.output_format == OutputFormat::Esmodule,
            nomodule: false,
          });
        }
        AssetType::Css => {
          let src = bundle
            .name
            .as_ref()
            .unwrap()
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_owned();
          bundles.push(BundleReference::StyleSheet {
            href: SerializableTendril(src.into()),
          });
        }
        _ => {}
      }
    }

    let res = package_html(PackageOptions {
      code,
      xml: bundle.ty == AssetType::Xhtml,
      bundles,
      inline_bundles,
      import_map: Default::default(),
    })
    .unwrap();

    Ok(Arc::new(BufferContent::new(res.code)))
  }
}
