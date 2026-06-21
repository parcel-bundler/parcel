use std::{borrow::Cow, sync::Arc};

use crate::{
  Asset, AssetFlags, AssetRequest, AssetSymbols, AssetType, DependencyFlags, DependencyResolution,
  DiagnosticList, FileSystem, Invalidations, ParcelOptions, Pipeline, SourceUrl,
  TrackingFileSystem,
  config::{ParcelConfig, PipelineMap},
  resolver::resolve,
};

pub trait Transformer: Send + Sync {
  /// Transforms an asset.
  ///
  /// `fs` is a per-request file system: any files a transformer reads through it (e.g. config or
  /// sidecar files, via [`FileSystem::read`], [`FileSystem::glob`] or
  /// [`FileSystem::find_ancestor_file`]) are automatically recorded as invalidations, so editing
  /// them re-runs this transform. Read the asset's own source through `asset.content`, not `fs`.
  fn transform(
    &self,
    asset: Asset,
    options: &ParcelOptions,
    fs: &Arc<dyn FileSystem>,
  ) -> Result<Asset, DiagnosticList>;
}

pub struct TransformRequest {
  pub index: usize,
  pub req: Arc<AssetRequest>,
  pub options: Arc<ParcelOptions>,
  pub config: Arc<ParcelConfig>,
}

pub struct TransformResult {
  pub index: usize,
  pub invalidations: Invalidations,
  pub result: Result<Asset, DiagnosticList>,
}

impl TransformRequest {
  pub fn run(&self) -> TransformResult {
    let index = self.index;
    let mut invalidations = Invalidations::default();

    // Add the source file itself as an invalidation so changes to it trigger re-transformation.
    invalidations
      .invalidate_on_file_change
      .push(self.req.loc.url.clone());

    let result = self.transform(&mut invalidations);

    TransformResult {
      index,
      invalidations,
      result,
    }
  }

  fn transform(&self, invalidations: &mut Invalidations) -> Result<Asset, DiagnosticList> {
    let req = &self.req;
    let relative_path = relative_path(&req.loc.url, &self.options.project_root, &req.ty);
    let transformer_pipeline = self
      .config
      .transformers
      .get(&relative_path, &req.pipeline, false);

    let mut flags = AssetFlags::empty();
    flags.set(AssetFlags::SIDE_EFFECTS, req.side_effects);
    flags.set(
      AssetFlags::IS_SOURCE,
      !req.loc.url.as_str().contains("/node_modules/"), // TODO: symlinks
    );

    let asset = Asset {
      ty: req.ty.clone(),
      content: req.content.clone(),
      loc: req.loc.clone(),
      target: req.target.clone(),
      pipeline: req.pipeline.clone(),
      bundle_behavior: crate::BundleBehavior::None,
      flags,
      unique_key: None,
      dependencies: Vec::new(),
      symbols: AssetSymbols::default(),
    };

    // Per-request tracker: files read by transformer plugins *and resolvers* through `fs` become
    // invalidations automatically. It wraps the shared cached input file system and records
    // `project://` URLs so they match the asset graph's invalidation map.
    let tracker = Arc::new(TrackingFileSystem::with_project_root(
      self.options.input_fs.clone(),
      self.options.project_root.clone(),
    ));
    let fs: Arc<dyn FileSystem> = tracker.clone();

    let result = {
      let mut asset = transform(
        asset,
        transformer_pipeline,
        &self.config.transformers,
        &self.options,
        &fs,
      )?;

      let resolvers = &self.config.resolvers;
      let named_pipelines = self.config.transformers.named_pipelines();
      for dep in &mut asset.dependencies {
        if dep.resolution == DependencyResolution::None {
          dep.resolution = resolve(dep, resolvers, &named_pipelines, &*self.options, &fs)?;
        }

        if let DependencyResolution::Deferred(req) = &dep.resolution {
          if req.side_effects {
            dep.flags |= DependencyFlags::SIDE_EFFECTS;
          }
        }
      }

      Ok(asset)
    };

    // Merge everything read during transform and resolution (even on error, so fixing a bad input
    // re-runs this asset).
    invalidations.extend(&tracker.take());
    result
  }
}

pub fn transform(
  asset: Asset,
  pipeline: Pipeline<dyn Transformer>,
  transformers: &PipelineMap<dyn Transformer>,
  options: &ParcelOptions,
  fs: &Arc<dyn FileSystem>,
) -> Result<Asset, DiagnosticList> {
  let mut input = asset;

  for plugin in &pipeline.0 {
    let ty: AssetType = input.ty.clone();
    let mut result = plugin.transform(input, options, fs)?;
    if result.ty != ty {
      let next_path = relative_path(&result.loc.url, &options.project_root, &result.ty);

      let mut next_pipeline = transformers.get(&next_path, &result.pipeline, false);
      if result.pipeline.is_some() && next_pipeline.0.is_empty() {
        result.pipeline = None;
        next_pipeline = transformers.get(&next_path, &result.pipeline, false);
      }

      if next_pipeline != pipeline {
        return transform(result, next_pipeline, transformers, options, fs);
      }
    }

    input = result;
  }

  Ok(input)
}

fn relative_path<'a>(url: &'a SourceUrl, project_root: &SourceUrl, ty: &AssetType) -> Cow<'a, str> {
  let mut relative_path = Cow::Borrowed(if url.url().scheme() == "project" {
    // project:// URLs are already relative to project root; strip the leading '/'
    url.path().trim_start_matches('/')
  } else {
    url
      .path()
      .strip_prefix(project_root.path())
      .unwrap_or(url.path())
  });
  let (base, ext) = relative_path
    .rsplit_once('.')
    .unwrap_or((relative_path.as_ref(), ""));
  if ty.extension() != ext {
    *relative_path.to_mut() = format!("{}.{}", base, ty.extension());
  }
  relative_path
}

// #[cfg(test)]
// mod tests {
//   use std::sync::Arc;

//   use indexmap::indexmap;

//   use super::*;
//   use crate::{AssetFlags, AssetType, Environment, SourceUrl, config::PipelineNode};

//   struct SimpleTransformer {
//     content: &'static str,
//   }

//   impl Transformer for SimpleTransformer {
//     fn transform(
//       &self,
//       mut asset: Asset,
//       _options: &ParcelOptions,
//     ) -> Result<Asset, Vec<Diagnostic>> {
//       asset.content.extend_from_slice(self.content.as_bytes());
//       Ok(asset)
//     }
//   }

//   struct TypeChangeTransformer {}
//   impl Transformer for TypeChangeTransformer {
//     fn transform(
//       &self,
//       mut asset: Asset,
//       _options: &ParcelOptions,
//     ) -> Result<Asset, Vec<Diagnostic>> {
//       if asset.flags.contains(AssetFlags::IS_SOURCE) {
//         asset.content.extend_from_slice(":type-change".as_bytes());
//         asset.ty = AssetType::Css;
//       }
//       Ok(asset)
//     }
//   }

//   #[test]
//   fn test_transform() {
//     let input = Asset {
//       content: Vec::new(),
//       ty: AssetType::Js,
//       bundle_behavior: crate::BundleBehavior::None,
//       env: Arc::new(Environment::default()),
//       flags: AssetFlags::empty(),
//       loc: crate::SourceLocation {
//         url: SourceUrl::parse("test.js").unwrap(),
//         ..Default::default()
//       },
//       pipeline: None,
//       unique_key: None,
//       dependencies: Vec::new(),
//     };

//     let transformers = PipelineMap(indexmap! {
//       "*.js".into() => vec![
//         PipelineNode::Plugin(Plugin::<dyn Transformer> {
//           package_name: "type-change".into(),
//           key_path: None,
//           plugin: Arc::new(TypeChangeTransformer {})
//         }),
//         PipelineNode::Plugin(Plugin::<dyn Transformer> {
//           package_name: "simple".into(),
//           key_path: None,
//           plugin: Arc::new(SimpleTransformer {
//             content: ":simple-js"
//           })
//         }),
//       ],
//       "*.css".into() => vec![
//         PipelineNode::Plugin(Plugin::<dyn Transformer> {
//           package_name: "simple".into(),
//           key_path: None,
//           plugin: Arc::new(SimpleTransformer {
//             content: ":simple-css"
//           })
//         }),
//       ]
//     });

//     let pipeline = transformers.get::<&str>("test.js", &None, false);
//     let res = transform(input, pipeline, &transformers, &Default::default()).unwrap();

//     assert_eq!(res.ty, AssetType::Js);
//     assert_eq!(res.content, "multi-1:simple-js".as_bytes().to_vec());
//   }
// }
