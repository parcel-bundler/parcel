use crate::{
  Asset, Dependency, Diagnostic,
  config::{JsPlugin, PipelineMap, Plugin},
};

pub trait Transformer {
  fn transform(&self, asset: Asset) -> Result<Vec<TransformerResult>, Vec<Diagnostic>>;
}

#[derive(Debug, serde::Deserialize)]
pub struct TransformerResult {
  pub asset: Asset,
  pub dependencies: Vec<Dependency>,
  // pub invalidations: Vec<Invalidation>,
}

impl Transformer for JsPlugin {
  fn transform(&self, _asset: Asset) -> Result<Vec<TransformerResult>, Vec<Diagnostic>> {
    Err(vec![])
  }
}

pub fn transform(
  asset: Asset,
  pipeline: Vec<Plugin<dyn Transformer>>,
  transformers: &PipelineMap<dyn Transformer>,
) -> Result<Vec<TransformerResult>, Vec<Diagnostic>> {
  let initial_type = asset.ty.clone();
  let mut input_assets = vec![TransformerResult {
    asset,
    dependencies: Vec::new(),
  }];

  let mut final_assets = Vec::new();
  for plugin in &pipeline {
    let mut result_assets = Vec::new();
    for input in input_assets {
      if input.asset.ty != initial_type {
        result_assets.push(input);
        continue;
      }

      let ty = input.asset.ty.clone();
      let results = plugin.plugin.transform(input.asset)?;
      for result in results {
        if result.asset.ty != ty {
          let next_path = result
            .asset
            .file_path()
            .with_extension(result.asset.ty.extension());
          let next_pipeline = transformers.get(&next_path, &result.asset.pipeline, false);
          if next_pipeline != pipeline {
            let results = transform(result.asset, next_pipeline, transformers)?;
            result_assets.extend(results);
          }
        } else {
          result_assets.push(result);
          // TODO: extend dependencies?
        }
      }
    }

    input_assets = result_assets;
  }

  final_assets.extend(input_assets);
  Ok(final_assets)
}

#[cfg(test)]
mod tests {
  use std::{path::Path, sync::Arc};

  use indexmap::indexmap;

  use super::*;
  use crate::{AssetFlags, AssetType, Environment, config::PipelineNode};

  struct SimpleTransformer {
    content: &'static str,
  }

  impl Transformer for SimpleTransformer {
    fn transform(&self, mut asset: Asset) -> Result<Vec<TransformerResult>, Vec<Diagnostic>> {
      asset.content.extend_from_slice(self.content.as_bytes());
      Ok(vec![TransformerResult {
        asset,
        dependencies: vec![],
      }])
    }
  }

  struct MultiTransformer {}
  impl Transformer for MultiTransformer {
    fn transform(&self, asset: Asset) -> Result<Vec<TransformerResult>, Vec<Diagnostic>> {
      Ok(vec![
        TransformerResult {
          asset: Asset {
            content: "multi-1".as_bytes().into(),
            ..asset.clone()
          },
          dependencies: vec![],
        },
        TransformerResult {
          asset: Asset {
            content: "multi-2".as_bytes().into(),
            flags: AssetFlags::IS_SOURCE,
            ..asset.clone()
          },
          dependencies: vec![],
        },
      ])
    }
  }

  struct TypeChangeTransformer {}
  impl Transformer for TypeChangeTransformer {
    fn transform(&self, mut asset: Asset) -> Result<Vec<TransformerResult>, Vec<Diagnostic>> {
      if asset.flags.contains(AssetFlags::IS_SOURCE) {
        asset.content.extend_from_slice(":type-change".as_bytes());
        asset.ty = AssetType::Css;
      }
      Ok(vec![TransformerResult {
        asset,
        dependencies: vec![],
      }])
    }
  }

  #[test]
  fn test_transform() {
    let input = Asset {
      content: Vec::new(),
      ty: AssetType::Js,
      bundle_behavior: crate::BundleBehavior::None,
      env: Arc::new(Environment::default()),
      flags: AssetFlags::empty(),
      loc: Some(crate::SourceLocation {
        file_path: "test.js".into(),
        ..Default::default()
      }),
      pipeline: None,
      unique_key: None,
    };

    let transformers = PipelineMap(indexmap! {
      "*.js".into() => vec![
        PipelineNode::Plugin(Plugin::<dyn Transformer> {
          package_name: "multi".into(),
          key_path: None,
          plugin: Arc::new(MultiTransformer {})
        }),
        PipelineNode::Plugin(Plugin::<dyn Transformer> {
          package_name: "type-change".into(),
          key_path: None,
          plugin: Arc::new(TypeChangeTransformer {})
        }),
        PipelineNode::Plugin(Plugin::<dyn Transformer> {
          package_name: "simple".into(),
          key_path: None,
          plugin: Arc::new(SimpleTransformer {
            content: ":simple-js"
          })
        }),
      ],
      "*.css".into() => vec![
        PipelineNode::Plugin(Plugin::<dyn Transformer> {
          package_name: "simple".into(),
          key_path: None,
          plugin: Arc::new(SimpleTransformer {
            content: ":simple-css"
          })
        }),
      ]
    });

    let pipeline = transformers.get::<&str>(Path::new("test.js"), &None, false);
    let res = transform(input, pipeline, &transformers).unwrap();

    assert_eq!(res.len(), 2);
    println!("{:?}", res);
    assert_eq!(res[0].asset.ty, AssetType::Js);
    assert_eq!(
      res[0].asset.content,
      "multi-1:simple-js".as_bytes().to_vec()
    );
    assert_eq!(res[1].asset.ty, AssetType::Css);
    assert_eq!(
      res[1].asset.content,
      "multi-2:type-change:simple-css".as_bytes().to_vec()
    );
  }
}
