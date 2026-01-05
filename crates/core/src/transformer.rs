use std::sync::Arc;

use crate::{
  Asset, AssetFlags, AssetRequest, AssetSymbols, AssetType, BufferContent, Content,
  DependencyFlags, DependencyResolution, DiagnosticList, ParcelOptions, SourceLocation,
  config::{JsPlugin, ParcelConfig, PipelineMap, Plugin},
  content::FileContent,
  resolver::resolve,
};

pub trait Transformer: Send + Sync {
  fn transform(&self, asset: Asset, options: &ParcelOptions) -> Result<Asset, DiagnosticList>;
}

impl Transformer for JsPlugin {
  fn transform(&self, _asset: Asset, _options: &ParcelOptions) -> Result<Asset, DiagnosticList> {
    Err(DiagnosticList(vec![]))
  }
}

pub struct TransformRequest {
  pub index: usize,
  pub req: Arc<AssetRequest>,
  pub options: Arc<ParcelOptions>,
  pub config: Arc<ParcelConfig>,
}

pub struct TransformResult {
  pub index: usize,
  pub asset: Asset,
}

impl TransformRequest {
  pub fn run(&self) -> Result<TransformResult, DiagnosticList> {
    let req = &self.req;
    let path = req.url.with_extension(req.ty.extension()).unwrap();
    let transformer_pipeline = self
      .config
      .transformers
      .get(path.path(), &req.pipeline, false);

    let content: Arc<dyn Content> = if let Some(code) = &req.code {
      Arc::new(BufferContent::new(code.clone()))
    } else {
      Arc::new(FileContent::new(
        req.url.to_file_path().unwrap(),
        self.options.input_fs.clone(),
      ))
    };

    let mut flags = AssetFlags::empty();
    flags.set(AssetFlags::SIDE_EFFECTS, req.side_effects);

    let asset = Asset {
      ty: req.ty.clone(),
      content,
      loc: SourceLocation {
        url: req.url.clone(),
        ..Default::default()
      },
      env: req.env.clone(),
      pipeline: req.pipeline.clone(),
      bundle_behavior: crate::BundleBehavior::None,
      flags,
      unique_key: None,
      dependencies: Vec::new(),
      symbols: AssetSymbols::default(),
    };

    let mut asset = transform(
      asset,
      transformer_pipeline,
      &self.config.transformers,
      &self.options,
    )?;

    let resolvers = &self.config.resolvers;
    let named_pipelines = self.config.transformers.named_pipelines();
    for dep in &mut asset.dependencies {
      if dep.resolution == DependencyResolution::None {
        dep.resolution = resolve(dep, resolvers, &named_pipelines)?;
      }

      if let DependencyResolution::Deferred(req) = &dep.resolution {
        if req.side_effects {
          dep.flags |= DependencyFlags::SIDE_EFFECTS;
        }
      }
    }

    Ok(TransformResult {
      index: self.index,
      asset,
    })
  }
}

pub fn transform(
  asset: Asset,
  pipeline: Vec<Plugin<dyn Transformer>>,
  transformers: &PipelineMap<dyn Transformer>,
  options: &ParcelOptions,
) -> Result<Asset, DiagnosticList> {
  let mut input = asset;

  for plugin in &pipeline {
    let ty: AssetType = input.ty.clone();
    let result = plugin.plugin.transform(input, options)?;
    if result.ty != ty {
      let next_path = result
        .loc
        .url
        .with_extension(result.ty.extension())
        .unwrap();
      let next_pipeline = transformers.get(next_path.as_str(), &result.pipeline, false);
      if next_pipeline != pipeline {
        return transform(result, next_pipeline, transformers, options);
      }
    }

    input = result;
  }

  Ok(input)
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
