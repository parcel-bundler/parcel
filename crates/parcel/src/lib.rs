use parcel_core::{AssetNode, BuildOptions, BundleGraph, DiagnosticList, SourceUrl};

use crate::plugin_factory::DefaultPluginFactory;

mod bundler;
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

fn make_parcel(
  entries: &Vec<String>,
  options: BuildOptions,
) -> Result<parcel_core::Parcel, DiagnosticList> {
  let factory = DefaultPluginFactory::new(options.input_fs.clone());
  parcel_core::Parcel::new(entries, options, &factory)
}

pub fn build(entries: &Vec<String>, options: BuildOptions) -> Result<BundleGraph, DiagnosticList> {
  let start = std::time::Instant::now();
  let mut parcel = make_parcel(entries, options)?;
  match parcel.build() {
    Ok(g) => {
      println!("Built in {:?}", start.elapsed());
      Ok(g)
    }
    Err(err) => Err(err),
  }
}

pub fn watch(entries: &Vec<String>, options: BuildOptions) -> Result<(), DiagnosticList> {
  let mut parcel = make_parcel(entries, options)?;
  let project_root = parcel
    .project_root()
    .to_file_path(parcel.project_root())
    .unwrap();

  let start = std::time::Instant::now();
  match parcel.build() {
    Ok(_) => println!("Built in {:?}", start.elapsed()),
    Err(e) => print_diagnostics(&e, parcel.project_root()),
  }

  let watcher = parcel_watcher::watch(&project_root);
  while let Ok(events) = watcher.recv() {
    let changed_urls: Vec<SourceUrl> = events
      .iter()
      .filter_map(|e| SourceUrl::from_path(e.path.as_path(), parcel.project_root()).ok())
      .collect();

    let affected_indices = parcel.invalidate(&changed_urls);
    if affected_indices.is_empty() {
      continue;
    }

    let start = std::time::Instant::now();
    match parcel.build() {
      Ok(_) => println!("Rebuilt in {:?}", start.elapsed()),
      Err(e) => print_diagnostics(&e, parcel.project_root()),
    }
  }

  Ok(())
}

pub fn serve(entries: &Vec<String>, options: BuildOptions) -> Result<(), DiagnosticList> {
  let mut parcel = make_parcel(entries, options)?;
  let project_root = parcel
    .project_root()
    .to_file_path(parcel.project_root())
    .unwrap();

  let start = std::time::Instant::now();
  let graph = parcel.build()?;
  println!("Built in {:?}", start.elapsed());

  let server = server::serve_dir(
    &graph.asset_graph.entries[0]
      .target
      .dist_dir
      .to_file_path(&graph.project_root)?,
  );

  let watcher = parcel_watcher::watch(&project_root);
  while let Ok(events) = watcher.recv() {
    let changed_urls: Vec<SourceUrl> = events
      .iter()
      .filter_map(|e| SourceUrl::from_path(e.path.as_path(), parcel.project_root()).ok())
      .collect();

    let affected_indices = parcel.invalidate(&changed_urls);
    if affected_indices.is_empty() {
      continue;
    }

    let start = std::time::Instant::now();
    match parcel.build() {
      Ok(graph) => {
        println!("Rebuilt in {:?}", start.elapsed());

        let changed_assets: Vec<(u32, &AssetNode)> = affected_indices
          .iter()
          .map(|&index| (index as u32, &graph.asset_graph.assets[index]))
          .collect();

        let changed_assets: Vec<(u32, &parcel_core::Asset)> = changed_assets
          .iter()
          .filter_map(|(index, node)| {
            if let AssetNode::Asset(a) = node {
              Some((*index, a))
            } else {
              None
            }
          })
          .collect();

        if !changed_assets.is_empty() {
          server.emit_hmr_update(changed_assets, &graph);
        }
      }
      Err(e) => print_diagnostics(&e, parcel.project_root()),
    }
  }

  Ok(())
}

fn print_diagnostics(diagnostics: &DiagnosticList, project_root: &SourceUrl) {
  let mut stderr = std::io::stderr();
  diagnostics.report(&mut stderr, project_root).unwrap();
}
