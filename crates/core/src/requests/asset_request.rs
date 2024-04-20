use std::path::PathBuf;

use crate::{
  parcel_config::{PipelineMap, PluginNode},
  request_tracker::{Request, RequestResult},
  types::{Asset, AssetFlags, AssetStats, Dependency, EnvironmentId},
};

#[derive(Hash)]
pub struct AssetRequest<'a> {
  pub transformers: &'a PipelineMap,
  pub file_path: PathBuf,
  pub env: EnvironmentId,
}

#[derive(Clone, Debug)]
pub struct AssetRequestResult {
  pub asset: Asset,
  pub dependencies: Vec<Dependency>,
}

impl<'a> Request for AssetRequest<'a> {
  type Output = AssetRequestResult;

  fn run(&self, _farm: &crate::worker_farm::WorkerFarm) -> RequestResult<Self::Output> {
    // println!("transform {:?}", self.file_path);
    let asset = Asset {
      id: String::new(),
      file_path: self.file_path.clone(),
      env: self.env.clone(),
      query: None,
      asset_type: crate::types::AssetType::Js,
      content_key: String::new(),
      map_key: None,
      output_hash: String::new(),
      pipeline: None,
      meta: None,
      stats: AssetStats { size: 0, time: 0 },
      bundle_behavior: crate::types::BundleBehavior::None,
      flags: AssetFlags::empty(),
      symbols: Vec::new(),
      unique_key: None,
      ast: None,
    };

    let pipeline = self
      .transformers
      .get(&asset.file_path, &asset.pipeline, false);
    let result = run_pipeline(pipeline, asset, &self.transformers);

    RequestResult {
      result: Ok(result),
      invalidations: Vec::new(),
    }
  }
}

trait Transformer {
  fn transform(asset: &Asset) -> AssetRequestResult;
}

fn run_pipeline(
  pipeline: Vec<PluginNode>,
  asset: Asset,
  transformers: &PipelineMap,
) -> AssetRequestResult {
  let mut result = AssetRequestResult {
    asset,
    dependencies: vec![],
  };

  for transformer in pipeline {
    let transformed = run_transformer(transformer, &result.asset);
    if transformed.asset.asset_type != result.asset.asset_type {
      let next_path = transformed
        .asset
        .file_path
        .with_extension(result.asset.asset_type.extension());
      let pipeline = transformers.get(&next_path, &transformed.asset.pipeline, false);
      return run_pipeline(pipeline, transformed.asset, transformers);
    }
    result.asset = transformed.asset;
    result.dependencies.extend(transformed.dependencies);
  }

  result
}

fn run_transformer(plugin: PluginNode, asset: &Asset) -> AssetRequestResult {
  match plugin.package_name.as_str() {
    "@parcel/transformer-js" => JsTransformer::transform(asset),
    _ => AssetRequestResult {
      asset: asset.clone(),
      dependencies: vec![],
    },
  }
}

struct JsTransformer;

impl Transformer for JsTransformer {
  fn transform(asset: &Asset) -> AssetRequestResult {
    let code = std::fs::read(&asset.file_path).unwrap();
    let res = parcel_js_swc_core::transform(
      parcel_js_swc_core::Config {
        filename: asset.file_path.to_string_lossy().to_string(),
        code,
        ..Default::default()
      },
      None,
    )
    .unwrap();

    let deps = res
      .dependencies
      .into_iter()
      .map(|dep| {
        let mut dep = Dependency::new(dep.specifier.to_string(), asset.env);
        dep.source_path = Some(asset.file_path.clone());
        dep
      })
      .collect();

    AssetRequestResult {
      asset: Asset {
        id: String::new(),
        file_path: asset.file_path.clone(),
        env: asset.env.clone(),
        query: None,
        asset_type: crate::types::AssetType::Js,
        content_key: String::new(),
        map_key: None,
        output_hash: String::new(),
        pipeline: None,
        meta: None,
        stats: AssetStats { size: 0, time: 0 },
        bundle_behavior: crate::types::BundleBehavior::None,
        flags: AssetFlags::empty(),
        symbols: Vec::new(),
        unique_key: None,
        ast: None,
      },
      dependencies: deps,
    }
  }
}
