use std::sync::Arc;

use parcel_core::{
  AssetNode, BuildOptions, BundleGraph, DiagnosticList, PathId, PluginFactory, SourceUrl,
};

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
  let make_factory: Arc<parcel_core::FactoryBuilder> =
    Arc::new(|fs| Box::new(DefaultPluginFactory::new(fs)) as Box<dyn PluginFactory>);
  parcel_core::Parcel::new(entries, options, make_factory)
}

pub fn build(
  entries: &Vec<String>,
  options: BuildOptions,
) -> Result<BundleGraph<'static>, DiagnosticList> {
  let start = std::time::Instant::now();
  let parcel = make_parcel(entries, options)?;
  match parcel.build_owned() {
    Ok(g) => {
      println!("Built in {:?}", start.elapsed());
      Ok(g)
    }
    Err(err) => Err(err),
  }
}

pub fn watch(entries: &Vec<String>, options: BuildOptions) -> Result<(), DiagnosticList> {
  let mut parcel = make_parcel(entries, options)?;
  let project_root = parcel.project_root();

  let start = std::time::Instant::now();
  match parcel.build() {
    Ok(_) => println!("Built in {:?}", start.elapsed()),
    Err(e) => print_diagnostics(&e),
  }

  let watcher = parcel_watcher::watch(&project_root.to_path_buf());
  while let Ok(events) = watcher.recv() {
    let (changed_paths, created_paths) = split_events(&events);

    let result = match parcel.invalidate(&changed_paths, &created_paths) {
      Ok(result) => result,
      Err(e) => {
        print_diagnostics(&e);
        continue;
      }
    };
    if !result.needs_rebuild() {
      continue;
    }

    let start = std::time::Instant::now();
    match parcel.build() {
      Ok(_) => println!("Rebuilt in {:?}", start.elapsed()),
      Err(e) => print_diagnostics(&e),
    }
  }

  Ok(())
}

pub fn serve(entries: &Vec<String>, options: BuildOptions) -> Result<(), DiagnosticList> {
  let mut parcel = make_parcel(entries, options)?;
  let project_root = parcel.project_root();

  let start = std::time::Instant::now();
  let graph = parcel.build()?;
  println!("Built in {:?}", start.elapsed());

  let server = server::serve_dir(&graph.asset_graph.entries[0].target.dist_dir.to_path_buf());

  let watcher = parcel_watcher::watch(&project_root.to_path_buf());
  while let Ok(events) = watcher.recv() {
    let (changed_paths, created_paths) = split_events(&events);

    let result = match parcel.invalidate(&changed_paths, &created_paths) {
      Ok(result) => result,
      Err(e) => {
        print_diagnostics(&e);
        continue;
      }
    };
    if !result.needs_rebuild() {
      continue;
    }
    // On a config change the Parcel was rebuilt from scratch; there are no specific changed asset
    // indices, so HMR is skipped in favour of the full rebuild's output.
    let affected_indices = result.affected;

    let start = std::time::Instant::now();
    let config = parcel.config.clone();
    let options = parcel.options.clone();
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
          server.emit_hmr_update(changed_assets, &graph, &*config, &*options);
        }
      }
      Err(e) => print_diagnostics(&e),
    }
  }

  Ok(())
}

fn print_diagnostics(diagnostics: &DiagnosticList) {
  let mut stderr = std::io::stderr();
  diagnostics.report(&mut stderr).unwrap();
}

/// Splits watcher events into `(changed, created)` URL lists. Modified and deleted files are
/// treated as changes; only newly created files count as creations.
fn split_events(events: &[parcel_watcher::Event]) -> (Vec<PathId>, Vec<PathId>) {
  let mut changed = Vec::new();
  let mut created = Vec::new();
  for event in events {
    let path = PathId::new(&event.path);
    match event.ty {
      parcel_watcher::EventType::Created => created.push(path),
      parcel_watcher::EventType::Updated | parcel_watcher::EventType::Deleted => changed.push(path),
    }
  }
  (changed, created)
}
