use std::collections::HashSet;

use parcel_core::{
  AssetNode, BuildOptions, BundleGraph, DiagnosticList, SourceUrl, resolve_entries,
};

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
  let factory = DefaultPluginFactory::new(options.input_fs.clone());
  match parcel_core::build(entries, options, &factory) {
    Ok(g) => {
      println!("Built in {:?}", start.elapsed());
      Ok(g)
    }
    Err(err) => {
      let mut stderr = std::io::stderr();
      err.report(&mut stderr).unwrap();
      Err(err)
    }
  }
}

pub fn watch(entries: Vec<String>, options: BuildOptions) -> Result<(), DiagnosticList> {
  let (_, project_root) = resolve_entries(entries.clone(), &options)?;
  build(entries.clone(), options.clone());

  let watcher = parcel_watcher::watch(&project_root);
  while let Ok(events) = watcher.recv() {
    println!("{:?}", events);
    if events
      .iter()
      .any(|e| !e.path.as_os_str().to_str().unwrap().contains("dist"))
    {
      build(entries.clone(), options.clone());
    }
  }

  Ok(())
}

pub fn serve(entries: Vec<String>, options: BuildOptions) -> Result<(), DiagnosticList> {
  let graph = build(entries.clone(), options.clone())?; // TODO
  let server = server::serve_dir(
    &graph.asset_graph.entries[0]
      .target
      .dist_dir
      .to_file_path()?,
  );

  let (_, project_root) = resolve_entries(entries.clone(), &options)?;
  let watcher = parcel_watcher::watch(&project_root);
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

  Ok(())
}
