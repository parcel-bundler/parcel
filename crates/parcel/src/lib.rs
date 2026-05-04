use std::{collections::HashSet, path::Path};

use parcel_core::{AssetNode, BuildOptions, BundleGraph, DiagnosticList, SourceUrl};

use crate::plugin_factory::DefaultPluginFactory;

mod data_url;
mod glob_resolver;
mod inline;
mod json;
mod library_bundler;
mod namer;
mod plugin_factory;
mod raw;
mod resolver;
mod server;
mod toml;
mod yaml;

pub fn build(entries: Vec<String>, options: BuildOptions) -> Result<BundleGraph, DiagnosticList> {
  let start = std::time::Instant::now();
  match parcel_core::build(entries, options, &DefaultPluginFactory {}) {
    Ok(g) => {
      println!("SUCCESS! {:?}", start.elapsed());
      Ok(g)
    }
    Err(err) => {
      let mut stderr = std::io::stderr();
      err.report(&mut stderr).unwrap();
      Err(err)
    }
  }
}

pub fn watch(entries: Vec<String>, options: BuildOptions) {
  build(entries.clone(), options.clone());

  let watcher = parcel_watcher::watch(Path::new("/Users/devongovett/dev/parcel/test"));
  while let Ok(events) = watcher.recv() {
    println!("{:?}", events);
    if events
      .iter()
      .any(|e| !e.path.as_os_str().to_str().unwrap().contains("dist"))
    {
      build(entries.clone(), options.clone());
    }
  }
}

pub fn serve(entries: Vec<String>, options: BuildOptions) {
  let server = server::serve_dir(Path::new("/Users/devongovett/dev/parcel/test/dist"));
  build(entries.clone(), options.clone());

  let watcher = parcel_watcher::watch(Path::new("/Users/devongovett/dev/parcel/test"));
  while let Ok(events) = watcher.recv() {
    if events
      .iter()
      .any(|e| !e.path.as_os_str().to_str().unwrap().contains("dist"))
    {
      let result = build(entries.clone(), options.clone());
      match result {
        Ok(graph) => {
          let changed_urls: HashSet<_> = events
            .iter()
            .map(|e| SourceUrl::from_path(e.path.as_path()).unwrap())
            .collect();

          // TODO: also include new assets
          let changed_assets: Vec<_> = graph
            .asset_graph
            .assets
            .iter()
            .enumerate()
            .filter_map(|(index, a)| {
              if let AssetNode::Asset(a) = a {
                if changed_urls.contains(&a.loc.url) {
                  Some((index as u32, a))
                } else {
                  None
                }
              } else {
                None
              }
            })
            .collect();

          if !changed_assets.is_empty() {
            server.emit_hmr_update(changed_assets, &graph);
          }
        }
        Err(_) => {}
      }
    }
  }
}
