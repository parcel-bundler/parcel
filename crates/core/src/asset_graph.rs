use std::{
  collections::HashMap,
  sync::{Arc, mpsc},
};

use crate::{
  Asset, AssetRequest, AssetType, DependencyResolution, Diagnostic, Entry, ParcelOptions,
  config::ParcelConfig,
  request::{Request, RequestResult, spawn_workers},
  transformer::TransformRequest,
};

pub struct AssetGraph {
  pub assets: Vec<Option<Asset>>,
  pub entries: Vec<Entry>,
}

pub fn build_asset_graph(
  mut entries: Vec<Entry>,
  config: Arc<ParcelConfig>,
  options: Arc<ParcelOptions>,
) -> Result<AssetGraph, Vec<Diagnostic>> {
  let (request_sender, request_receiver) = mpsc::channel::<Request>();
  let (result_sender, result_receiver) = mpsc::channel::<RequestResult>();

  spawn_workers(request_receiver, result_sender);

  let mut assets: Vec<Option<Asset>> = Vec::new();
  let mut asset_requests: HashMap<Arc<AssetRequest>, usize> = HashMap::new();

  let mut pending_requests = 0;
  for entry in &mut entries {
    pending_requests += 1;

    let req = Arc::new(AssetRequest {
      url: entry.url.clone(),
      ty: AssetType::from_url(&entry.url),
      code: None,
      env: entry.target.env.clone(),
      pipeline: None,
      side_effects: true,
    });

    let index = assets.len();
    assets.push(None);
    entry.asset = Some(index);
    asset_requests.insert(req.clone(), index);
    let request = Request::Transform(TransformRequest {
      index,
      req,
      options: options.clone(),
      config: config.clone(),
    });
    request_sender.send(request).unwrap();
  }

  while pending_requests > 0 {
    let result = result_receiver.recv().unwrap();
    pending_requests -= 1;

    match result {
      RequestResult::Transform(res) => {
        let mut res = res?;
        for dep in &mut res.asset.dependencies {
          match &mut dep.resolution {
            DependencyResolution::Deferred(req) => {
              if let Some(index) = asset_requests.get(req) {
                dep.resolution = DependencyResolution::Asset(*index as u32);
              } else {
                let index = assets.len();
                assets.push(None);
                asset_requests.insert(req.clone(), index);

                let request = Request::Transform(TransformRequest {
                  index,
                  req: req.clone(),
                  options: options.clone(),
                  config: config.clone(),
                });

                dep.resolution = DependencyResolution::Asset(index as u32);
                pending_requests += 1;
                request_sender.send(request).unwrap();
              }
            }
            _ => {}
          }
        }

        assets[res.index] = Some(res.asset);
      }
    }
  }

  Ok(AssetGraph { assets, entries })
}
