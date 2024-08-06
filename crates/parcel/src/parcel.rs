use std::path::PathBuf;
use std::sync::Arc;

use parcel_config::parcel_rc_config_loader::LoadConfigOptions;
use parcel_config::parcel_rc_config_loader::ParcelRcConfigLoader;
use parcel_core::asset_graph::AssetGraph;
use parcel_core::config_loader::ConfigLoader;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::PluginLogger;
use parcel_core::plugin::PluginOptions;
use parcel_core::plugin::ReporterEvent;
use parcel_core::types::ParcelOptions;
use parcel_filesystem::os_file_system::OsFileSystem;
use parcel_filesystem::FileSystemRef;
use parcel_package_manager::NodePackageManager;
use parcel_package_manager::PackageManagerRef;
use parcel_plugin_rpc::RpcHostRef;
use parcel_plugin_rpc::RpcWorkerRef;

use crate::plugins::config_plugins::ConfigPlugins;
use crate::plugins::PluginsRef;
use crate::project_root::infer_project_root;
use crate::request_tracker::RequestTracker;
use crate::requests::AssetGraphRequest;
use crate::requests::RequestResult;

#[derive(Clone)]
struct ParcelState {
  config: Arc<ConfigLoader>,
  rpc_worker: Option<RpcWorkerRef>,
  plugins: PluginsRef,
}

pub struct Parcel {
  pub fs: FileSystemRef,
  pub options: ParcelOptions,
  pub package_manager: PackageManagerRef,
  pub project_root: PathBuf,
  pub rpc_host: Option<RpcHostRef>,
  state: Option<ParcelState>,
}

impl Parcel {
  pub fn new(
    fs: Option<FileSystemRef>,
    options: ParcelOptions,
    package_manager: Option<PackageManagerRef>,
    rpc_host: Option<RpcHostRef>,
  ) -> Result<Self, anyhow::Error> {
    let fs = fs.unwrap_or_else(|| Arc::new(OsFileSystem::default()));
    let project_root = infer_project_root(Arc::clone(&fs), options.entries.clone())?;

    let package_manager = package_manager
      .unwrap_or_else(|| Arc::new(NodePackageManager::new(project_root.clone(), fs.clone())));

    Ok(Self {
      fs,
      options,
      package_manager,
      project_root,
      rpc_host,
      state: None,
    })
  }
}

pub struct BuildResult;

impl Parcel {
  fn state(&mut self) -> anyhow::Result<ParcelState> {
    if let Some(state) = self.state.clone() {
      return Ok(state);
    }

    let mut rpc_worker = None;
    if let Some(rpc_host) = &self.rpc_host {
      rpc_worker = Some(rpc_host.start()?)
    }

    let (config, _files) =
      ParcelRcConfigLoader::new(Arc::clone(&self.fs), Arc::clone(&self.package_manager)).load(
        &self.project_root,
        LoadConfigOptions {
          additional_reporters: vec![], // TODO
          config: self.options.config.as_deref(),
          fallback_config: self.options.fallback_config.as_deref(),
        },
      )?;

    let config_loader = Arc::new(ConfigLoader {
      fs: Arc::clone(&self.fs),
      project_root: self.project_root.clone(),
      search_path: self.project_root.join("index"),
    });

    let plugins = Arc::new(ConfigPlugins::new(
      config,
      PluginContext {
        config: Arc::clone(&config_loader),
        options: Arc::new(PluginOptions {
          mode: self.options.mode.clone(),
          project_root: self.project_root.clone(),
        }),
        // TODO Initialise actual logger
        logger: PluginLogger::default(),
      },
      rpc_worker.clone(),
    )?);

    let state = ParcelState {
      config: config_loader,
      plugins,
      rpc_worker,
    };

    self.state = Some(state.clone());

    Ok(state)
  }

  pub fn build(&mut self) -> anyhow::Result<()> {
    let ParcelState {
      config,
      plugins,
      rpc_worker: _,
    } = self.state()?;

    println!("hello");

    plugins.reporter().report(&ReporterEvent::BuildStart)?;

    let mut _request_tracker = RequestTracker::new(
      config.clone(),
      self.fs.clone(),
      Arc::new(self.options.clone()),
      plugins.clone(),
      self.project_root.clone(),
    );

    Ok(())
  }

  pub fn build_asset_graph(&mut self) -> anyhow::Result<AssetGraph> {
    let ParcelState {
      config,
      plugins,
      rpc_worker: _,
    } = self.state()?;

    let mut request_tracker = RequestTracker::new(
      config.clone(),
      self.fs.clone(),
      Arc::new(self.options.clone()),
      plugins.clone(),
      self.project_root.clone(),
    );

    let request_result = request_tracker.run_request(AssetGraphRequest {})?;

    let asset_graph = match request_result {
      RequestResult::AssetGraph(result) => result.graph,
      _ => panic!("TODO"),
    };

    Ok(asset_graph)
  }
}
