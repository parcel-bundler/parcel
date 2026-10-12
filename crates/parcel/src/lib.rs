use std::sync::Arc;

use fixedbitset::FixedBitSet;
use parcel_core::{
  BuildOptions, BuildResult, BundleGraph, DiagnosticList, HmrOptions, InvalidateResult, LogLevel,
  Parcel, ParcelConfig, ParcelOptions, PathId, PluginFactory,
};
use parcel_js::hmr::{HmrUpdate, get_hmr_update};

use crate::{
  plugin_factory::DefaultPluginFactory,
  run::{NodeRunner, entry_context_assets, node_entry},
};

pub use open_browser::is_browser_name;
pub use server::{HttpsOptions, ServerOptions};

mod bundler;
mod cert;
mod data_url;
mod glob_resolver;
mod http;
mod inline;
mod json;
mod json_urls;
mod jsonld;
mod launch_editor;
mod library_bundler;
#[cfg(target_os = "macos")]
mod macos;
mod namer;
mod open_browser;
mod plugin_factory;
mod raw;
mod resolver;
mod run;
mod server;
mod toml;
mod trust;
mod webmanifest;
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
    if invalidate_events(&mut parcel, &events).is_none() {
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
  // Before the server starts, so that pages aren't loaded before the CA is trusted.
  offer_trust(&server_options, &parcel.options);
  let project_root = parcel.project_root();

  let reporters = parcel.options.reporters.clone();
  let hmr = server_options.hmr;
  let scheme = if server_options.https.is_some() {
    "https"
  } else {
    "http"
  };
  // The server starts before the first build so that it can show the build's errors.
  let target = &parcel.entries()[0].target;
  let output = server::Output::new(target.dist_dir.to_path_buf(), &target.public_url);
  let base_path = output.base_path.clone();
  let (server, address, _) = server::serve(&server_options, Some(output))
    .inspect_err(|err| parcel.options.log_diagnostics(LogLevel::Error, &err.0))?;
  reporters.log(
    LogLevel::Info,
    &format!(
      "Server listening on {scheme}://localhost:{}{}",
      address.port(),
      if base_path == "/" { "" } else { &base_path }
    ),
  );
  server.set_reporters(reporters.clone());
  server.set_source_roots(
    &project_root.to_path_buf(),
    parcel
      .entries()
      .iter()
      .map(|entry| entry.target.dist_dir.to_path_buf()),
  );

  // Build errors are reported by the reporters, and shown in the browser until a build succeeds.
  server.build_started();
  let mut failed = match parcel.build() {
    Ok(graph) => {
      set_source_roots(&server, &project_root, &graph);
      server.build_succeeded();
      false
    }
    Err(e) => {
      server.build_failed(&e);
      true
    }
  };

  if server_options.open {
    // Opened in the background, since macOS may ask the user whether to allow controlling the
    // browser.
    let host = match &*server_options.host {
      host
        if host
          .parse::<std::net::IpAddr>()
          .is_ok_and(|ip| ip.is_unspecified()) =>
      {
        "localhost"
      }
      host => host,
    };
    let url = match host.parse::<std::net::IpAddr>() {
      Ok(std::net::IpAddr::V6(ip)) => format!("{scheme}://[{ip}]:{}{base_path}", address.port()),
      _ => format!("{scheme}://{host}:{}{base_path}", address.port()),
    };
    let browser = server_options.browser.clone();
    let reporters = reporters.clone();
    std::thread::spawn(move || {
      if let Err(message) = open_browser::open_browser(&url, browser.as_deref()) {
        reporters.log(LogLevel::Warn, &message);
      }
    });
  }

  let watcher = parcel_watcher::watch(&project_root.to_path_buf());
  while let Ok(events) = watcher.recv() {
    let Some(result) = invalidate_events(&mut parcel, &events) else {
      continue;
    };
    let config_changed = result.config_changed;

    let config = parcel.config.clone();
    let options = parcel.options.clone();
    server.build_started();
    match parcel.build_with_changes() {
      Ok(result) => {
        set_source_roots(&server, &project_root, &result.bundle_graph);
        server.build_succeeded();
        if hmr {
          match hmr_updates(config_changed, &result, &config, &options, None).browser {
            Some(update) => server.emit_hmr(&update),
            // Pages showing the previous build's errors reload.
            None if failed => server.emit_hmr(&HmrUpdate::Reload),
            None => {}
          }
        }
        failed = false;
      }
      Err(e) => {
        server.build_failed(&e);
        if hmr {
          server.emit_hmr_error(&e);
        }
        failed = true;
      }
    }
  }

  Ok(())
}

pub fn run(
  entries: &Vec<String>,
  mut options: BuildOptions,
  server_options: ServerOptions,
) -> Result<(), DiagnosticList> {
  // The HMR server is started before building because its port is compiled into the bundles.
  let hmr = if server_options.hmr {
    // The build's reporters don't exist yet, so errors are reported to the CLI's.
    let (server, address, events) = server::serve(&server_options, None).inspect_err(|err| {
      standalone_options(options.reporters.clone(), options.log_level.clone())
        .log_diagnostics(LogLevel::Error, &err.0)
    })?;
    options.hmr = Some(HmrOptions {
      host: server_options.host.clone(),
      port: address.port(),
    });
    Some((server, address, events))
  } else {
    None
  };
  let hmr_server = hmr.as_ref().map(|(server, _, _)| server.clone());

  let mut parcel = make_parcel(entries, options)?;
  if server_options.hmr {
    offer_trust(&server_options, &parcel.options);
  }
  let project_root = parcel.project_root();
  let mut runner = NodeRunner::new(hmr);
  if let Some(server) = &hmr_server {
    server.set_reporters(parcel.options.reporters.clone());
    server.set_source_roots(
      &project_root.to_path_buf(),
      parcel
        .entries()
        .iter()
        .map(|entry| entry.target.dist_dir.to_path_buf()),
    );
  }

  // Build errors are reported by the reporters. The process starts once a build succeeds.
  let mut started = match parcel.build() {
    Ok(graph) => {
      if let Some(server) = &hmr_server {
        set_source_roots(server, &project_root, &graph);
      }
      if let Some(entry) = node_entry(&graph) {
        runner.restart(graph.bundles[entry].dist_path());
      }
      true
    }
    Err(_) => false,
  };

  let watcher = parcel_watcher::watch(&project_root.to_path_buf());
  while let Ok(events) = watcher.recv() {
    let Some(result) = invalidate_events(&mut parcel, &events) else {
      continue;
    };
    let config_changed = result.config_changed;

    let config = parcel.config.clone();
    let options = parcel.options.clone();
    match parcel.build_with_changes() {
      Ok(result) => {
        if let Some(server) = &hmr_server {
          set_source_roots(server, &project_root, &result.bundle_graph);
        }
        let entry = node_entry(&result.bundle_graph);
        if !started {
          if let Some(entry) = entry {
            runner.restart(result.bundle_graph.bundles[entry].dist_path());
          }
          started = true;
          continue;
        }
        let updates = if hmr_server.is_some() {
          hmr_updates(config_changed, &result, &config, &options, entry)
        } else {
          // Without HMR, the process is restarted whenever code it runs changes.
          let changed = |entry| {
            config_changed || result.output_paths_changed || {
              let assets = entry_context_assets(&result.bundle_graph, entry);
              result
                .changed_assets
                .iter()
                .any(|asset| assets.contains(asset.index()))
            }
          };
          HmrUpdates {
            server: entry
              .filter(|&entry| changed(entry))
              .map(|_| HmrUpdate::Reload),
            browser: None,
          }
        };

        // Update the process before browsers, so that pages reloaded in response reach the new
        // code.
        match (entry, &updates.server) {
          (Some(entry), Some(update)) => {
            runner.update(result.bundle_graph.bundles[entry].dist_path(), update)
          }
          (Some(_), None) => {}
          (None, _) => runner.stop(),
        }

        if let Some(server) = &hmr_server
          && let Some(update) = &updates.browser
        {
          server.emit_hmr(update);
        }
      }
      Err(e) => {
        if let Some(server) = &hmr_server {
          server.emit_hmr_error(&e);
        }
      }
    }
  }

  Ok(())
}

/// Options for logging to `reporters` without a build. The returned options must be kept alive, as
/// the reporters only hold a weak reference to them.
fn standalone_options(
  reporters: Vec<Arc<dyn parcel_core::Reporter>>,
  log_level: LogLevel,
) -> Arc<ParcelOptions> {
  let reporters = parcel_core::Reporters::new(reporters, log_level.clone());
  let options = Arc::new(ParcelOptions {
    log_level,
    reporters: reporters.clone(),
    ..Default::default()
  });
  reporters.attach(Arc::downgrade(&options));
  options
}

/// An error from the CLI itself rather than from the build or a plugin.
pub(crate) fn cli_diagnostic(message: String) -> parcel_core::Diagnostic {
  parcel_core::Diagnostic {
    origin: Some("parcel".into()),
    ..parcel_core::Diagnostic::from_message(message)
  }
}

/// Offers to trust the local certificate authority before serving with certificates it signs (see
/// `trust::offer`).
fn offer_trust(server_options: &ServerOptions, options: &ParcelOptions) {
  if server_options.https == Some(HttpsOptions::Generate) {
    trust::offer(options);
  }
}

/// `parcel trust`, logging to `reporters` (see `trust::trust_command`).
pub fn trust(
  remove: bool,
  reporters: Vec<Arc<dyn parcel_core::Reporter>>,
  log_level: LogLevel,
) -> Result<(), DiagnosticList> {
  let options = standalone_options(reporters, log_level);
  trust::trust_command(remove, &options).map_err(|message| {
    let diagnostic = cli_diagnostic(message);
    options.log_diagnostic(LogLevel::Error, diagnostic.clone());
    DiagnosticList(vec![diagnostic])
  })
}

/// Lets `server` serve the source maps of `graph`'s bundles and of the project's source files.
fn set_source_roots(server: &server::HmrServer, project_root: &PathId, graph: &BundleGraph) {
  server.set_source_roots(
    &project_root.to_path_buf(),
    graph
      .bundles
      .iter()
      .map(|bundle| bundle.target.dist_dir.to_path_buf()),
  );
}

/// The HMR messages to send after a successful rebuild.
pub struct HmrUpdates<'a> {
  /// For the process running the server entry, if code it runs changed.
  pub server: Option<HmrUpdate<'a>>,
  /// For browsers.
  pub browser: Option<HmrUpdate<'a>>,
}

/// Splits the changes of a rebuild into updates for the process running `server_entry` (see
/// `parcel run`) and for browsers. Code both run, such as client components rendered on the
/// server, is in both. Browsers are told when code only the server runs changed, so that they can
/// refresh what it rendered.
pub fn hmr_updates<'a>(
  config_changed: bool,
  result: &'a BuildResult<'a>,
  config: &'a ParcelConfig,
  options: &'a ParcelOptions,
  server_entry: Option<usize>,
) -> HmrUpdates<'a> {
  // On a config change the Parcel was rebuilt from scratch, so there is no incremental update.
  if config_changed || result.output_paths_changed {
    return HmrUpdates {
      server: server_entry.map(|_| HmrUpdate::Reload),
      browser: Some(HmrUpdate::Reload),
    };
  }

  let graph = &result.bundle_graph;
  let server_assets = server_entry.map(|entry| entry_context_assets(graph, entry));
  let mut browser_assets = FixedBitSet::with_capacity(graph.asset_graph.assets.len());
  for bundle in &graph.bundles {
    if bundle.target.environment.is_browser() {
      browser_assets.extend(bundle.assets.iter().map(|asset| asset.index()));
    }
  }

  let mut server = Vec::new();
  let mut browser = Vec::new();
  let mut server_changed = false;
  for (index, asset) in result.changed_assets() {
    let in_browser = browser_assets.contains(index.index());
    if server_assets
      .as_ref()
      .is_some_and(|assets| assets.contains(index.index()))
    {
      server.push((index, asset));
      server_changed |= !in_browser;
    }
    if in_browser {
      browser.push((index, asset));
    }
  }

  let browser = if browser.is_empty() {
    server_changed.then_some(HmrUpdate::Update {
      assets: Vec::new(),
      server_changed: true,
    })
  } else {
    let mut update = get_hmr_update(browser, graph, config, options);
    if let HmrUpdate::Update {
      server_changed: changed,
      ..
    } = &mut update
    {
      *changed = server_changed;
    }
    Some(update)
  };
  HmrUpdates {
    server: (!server.is_empty()).then(|| get_hmr_update(server, graph, config, options)),
    browser,
  }
}

/// Invalidates the files changed by watcher `events`, returning `None` if there is nothing to
/// rebuild (or the config is now invalid).
fn invalidate_events(
  parcel: &mut Parcel,
  events: &[parcel_watcher::Event],
) -> Option<InvalidateResult> {
  let (changed, created, deleted) = split_events(events);
  let result = parcel.invalidate(&changed, &created, &deleted).ok()?;
  result.needs_rebuild().then_some(result)
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
