use std::{borrow::Cow, sync::Arc};

use crate::{
  Asset, AssetFlags, AssetNodeIndex, AssetRequest, AssetSymbols, AssetType, DependencyFlags,
  DependencyResolution, Diagnostic, DiagnosticList, FileSystem, Invalidations, ParcelOptions,
  PathId, Pipeline, SourceUrl, Target, TrackingFileSystem, config::ParcelConfig, resolver::resolve,
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
  pub index: AssetNodeIndex,
  pub req: Arc<AssetRequest>,
  pub options: Arc<ParcelOptions>,
  pub config: Arc<ParcelConfig>,
}

pub struct TransformResult {
  pub index: AssetNodeIndex,
  /// The request this result was produced from. Used to discard results that were
  /// superseded while in flight (the node's request was replaced with new content).
  pub req: Arc<AssetRequest>,
  pub invalidations: Invalidations,
  pub result: Result<Asset, DiagnosticList>,
}

impl TransformRequest {
  pub fn run(&self) -> TransformResult {
    let index = self.index;
    let mut invalidations = Invalidations::default();

    // Add the source file itself as an invalidation so changes to it trigger re-transformation.
    match self.req.loc.url.to_file_path() {
      Ok(path) => invalidations.invalidate_on_file_change.push(path),
      Err(diagnostic) => {
        return TransformResult {
          index,
          req: self.req.clone(),
          invalidations,
          result: Err(diagnostic.into()),
        };
      }
    }

    let result = self.transform(&mut invalidations);

    TransformResult {
      index,
      req: self.req.clone(),
      invalidations,
      result,
    }
  }

  fn transform(&self, invalidations: &mut Invalidations) -> Result<Asset, DiagnosticList> {
    let req = &self.req;
    let relative_path = relative_path(&req.loc.url, &self.options.project_root, &req.ty)?;
    let transformer_pipeline =
      self
        .config
        .transformers
        .get(Cow::Borrowed(&relative_path), &req.pipeline, false);

    let mut flags = AssetFlags::empty();
    flags.set(AssetFlags::SIDE_EFFECTS, req.side_effects);
    flags.set(
      AssetFlags::IS_SOURCE,
      !req.loc.url.to_file_path()?.in_node_modules(), // TODO: symlinks
    );

    let asset = Asset {
      ty: req.ty.clone(),
      content: req.content.clone(),
      loc: req.loc.clone(),
      target: req.target.clone(),
      pipeline: req.pipeline.clone(),
      bundle_behavior: crate::BundleBehavior::None,
      flags,
      unique_key: req.unique_key.clone(),
      dependencies: Vec::new(),
      symbols: AssetSymbols::default(),
    };

    // Per-request tracker: files read by transformer plugins *and resolvers* through `fs` become
    // invalidations automatically. It wraps the shared cached input file system and records the
    // file paths consulted while processing this request.
    let tracker = Arc::new(TrackingFileSystem::new(self.options.input_fs.clone()));
    let fs: Arc<dyn FileSystem> = tracker.clone();

    let result = {
      let mut asset = transform(asset, transformer_pipeline, &self.options, &fs)?;
      asset.target = Target::normalize(&asset.target, &asset.ty);

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

fn transform(
  asset: Asset,
  mut pipeline: Pipeline<'_, dyn Transformer>,
  options: &ParcelOptions,
  fs: &Arc<dyn FileSystem>,
) -> Result<Asset, DiagnosticList> {
  let mut input = asset;

  while let Some(plugin) = pipeline.next() {
    let ty: AssetType = input.ty.clone();
    let mut result = plugin.transform(input, options, fs)?;
    if result.ty != ty {
      let next_path = relative_path(&result.loc.url, &options.project_root, &result.ty)?;
      pipeline.change_type(next_path, &mut result.pipeline);
    }

    input = result;
  }

  Ok(input)
}

fn relative_path(
  url: &SourceUrl,
  project_root: &PathId,
  ty: &AssetType,
) -> Result<String, Diagnostic> {
  let path = url.to_file_path()?;
  let mut relative_path = path.relative(project_root);
  relative_path.set_extension(ty.extension());
  Ok(relative_path.to_string_lossy().into_owned())
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
