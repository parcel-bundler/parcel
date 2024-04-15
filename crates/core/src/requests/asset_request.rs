use std::path::PathBuf;

use crate::{
  request_tracker::{Request, RequestResult},
  types::{Asset, AssetFlags, AssetStats, Dependency, EnvironmentId},
};

#[derive(Hash)]
pub struct AssetRequest {
  pub file_path: PathBuf,
  pub env: EnvironmentId,
}

#[derive(Clone, Debug)]
pub struct AssetRequestResult {
  pub asset: Asset,
  pub dependencies: Vec<Dependency>,
}

impl Request for AssetRequest {
  type Output = AssetRequestResult;

  fn run(&self, _farm: &crate::worker_farm::WorkerFarm) -> RequestResult<Self::Output> {
    // println!("transform {:?}", self.file_path);
    let code = std::fs::read(&self.file_path).unwrap();
    let res = parcel_js_swc_core::transform(
      parcel_js_swc_core::Config {
        filename: self.file_path.to_string_lossy().to_string(),
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
        let mut dep = Dependency::new(dep.specifier.to_string(), self.env);
        dep.source_path = Some(self.file_path.clone());
        dep
      })
      .collect();

    RequestResult {
      result: Ok(AssetRequestResult {
        asset: Asset {
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
        },
        dependencies: deps,
      }),
      invalidations: Vec::new(),
    }
  }
}
