use std::sync::Arc;

use parcel_core::{BuildOptions, BundleFlags, BundleGraph, DiagnosticList, PathId, PluginFactory};

use crate::{plugin_factory::DefaultPluginFactory, run::run_node};

pub use server::ServerOptions;

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
mod run;
mod server;
mod toml;
mod yaml;

pub fn make_parcel(
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
  let parcel = make_parcel(entries, options)?;
  parcel.build_owned()
}

pub fn watch(entries: &Vec<String>, options: BuildOptions) -> Result<(), DiagnosticList> {
  let mut parcel = make_parcel(entries, options)?;
  let project_root = parcel.project_root();

  let _ = parcel.build();

  let watcher = parcel_watcher::watch(&project_root.to_path_buf());
  while let Ok(events) = watcher.recv() {
    let (changed_paths, created_paths, deleted_paths) = split_events(&events);

    let result = match parcel.invalidate(&changed_paths, &created_paths, &deleted_paths) {
      Ok(result) => result,
      Err(_) => {
        continue;
      }
    };
    if !result.needs_rebuild() {
      continue;
    }

    let _ = parcel.build();
  }

  Ok(())
}

pub fn serve(
  entries: &Vec<String>,
  options: BuildOptions,
  server_options: ServerOptions,
) -> Result<(), DiagnosticList> {
  let mut parcel = make_parcel(entries, options)?;
  let project_root = parcel.project_root();

  let graph = parcel.build()?;
  let server = server::serve_dir(
    &graph.asset_graph.entries[0].target.dist_dir.to_path_buf(),
    server_options,
  );

  let watcher = parcel_watcher::watch(&project_root.to_path_buf());
  while let Ok(events) = watcher.recv() {
    let (changed_paths, created_paths, deleted_paths) = split_events(&events);

    let result = match parcel.invalidate(&changed_paths, &created_paths, &deleted_paths) {
      Ok(result) => result,
      Err(_) => {
        continue;
      }
    };
    if !result.needs_rebuild() {
      continue;
    }
    let config_changed = result.config_changed;

    let config = parcel.config.clone();
    let options = parcel.options.clone();
    match parcel.build_with_changes() {
      Ok(result) => {
        // On a config change the Parcel was rebuilt from scratch, so HMR is skipped in favour of
        // the full rebuild's output.
        if !config_changed {
          if result.output_paths_changed {
            server.emit_hmr_reload();
          } else {
            let graph = &result.bundle_graph;
            let changed_assets = result.changed_assets();
            if !changed_assets.is_empty() {
              server.emit_hmr_update(changed_assets, graph, &*config, &*options);
            }
          }
        }
      }
      Err(e) => {
        server.emit_hmr_error(&e);
      }
    }
  }

  Ok(())
}

pub fn run(entries: &Vec<String>, options: BuildOptions) -> Result<(), DiagnosticList> {
  let mut parcel = make_parcel(entries, options)?;
  let project_root = parcel.project_root();

  let graph = parcel.build()?;
  let entry = graph
    .bundles
    .iter()
    .find(|b| b.flags.contains(BundleFlags::ENTRY) && b.target.environment.is_node());
  if let Some(entry) = entry {
    run_node(entry.dist_path());
  }

  let watcher = parcel_watcher::watch(&project_root.to_path_buf());
  while let Ok(events) = watcher.recv() {
    let (changed_paths, created_paths, deleted_paths) = split_events(&events);

    let result = match parcel.invalidate(&changed_paths, &created_paths, &deleted_paths) {
      Ok(result) => result,
      Err(_) => {
        continue;
      }
    };
    if !result.needs_rebuild() {
      continue;
    }

    let _ = parcel.build();
  }

  Ok(())
}

/// Splits watcher events into `(changed, created)` URL lists. Modified and deleted files are
/// treated as changes; only newly created files count as creations.
fn split_events(events: &[parcel_watcher::Event]) -> (Vec<PathId>, Vec<PathId>, Vec<PathId>) {
  let mut changed = Vec::new();
  let mut created = Vec::new();
  let mut deleted = Vec::new();
  for event in events {
    let path = PathId::new(&event.path);
    match event.ty {
      parcel_watcher::EventType::Created => created.push(path),
      parcel_watcher::EventType::Updated => changed.push(path),
      parcel_watcher::EventType::Deleted => deleted.push(path),
    }
  }
  (changed, created, deleted)
}
