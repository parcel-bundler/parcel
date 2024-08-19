use std::path::PathBuf;
use std::sync::Arc;

use atlaspack_config::atlaspack_rc_config_loader::AtlaspackRcConfigLoader;
use atlaspack_config::atlaspack_rc_config_loader::LoadConfigOptions;
use atlaspack_core::asset_graph::AssetGraph;
use atlaspack_core::config_loader::ConfigLoader;
use atlaspack_core::plugin::PluginContext;
use atlaspack_core::plugin::PluginLogger;
use atlaspack_core::plugin::PluginOptions;
use atlaspack_core::plugin::ReporterEvent;
use atlaspack_core::types::AtlaspackOptions;
use atlaspack_filesystem::os_file_system::OsFileSystem;
use atlaspack_filesystem::FileSystemRef;
use atlaspack_package_manager::NodePackageManager;
use atlaspack_package_manager::PackageManagerRef;
use atlaspack_plugin_rpc::RpcHostRef;
use atlaspack_plugin_rpc::RpcWorkerRef;

use crate::plugins::config_plugins::ConfigPlugins;
use crate::plugins::PluginsRef;
use crate::project_root::infer_project_root;
use crate::request_tracker::RequestTracker;
use crate::requests::AssetGraphRequest;
use crate::requests::RequestResult;

#[derive(Clone)]
struct AtlaspackState {
  config: Arc<ConfigLoader>,
  plugins: PluginsRef,
}

pub struct Atlaspack {
  pub fs: FileSystemRef,
  pub options: AtlaspackOptions,
  pub package_manager: PackageManagerRef,
  pub project_root: PathBuf,
  pub rpc: Option<RpcHostRef>,
  state: Option<AtlaspackState>,
}

impl Atlaspack {
  pub fn new(
    fs: Option<FileSystemRef>,
    options: AtlaspackOptions,
    package_manager: Option<PackageManagerRef>,
    rpc: Option<RpcHostRef>,
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
      rpc,
      state: None,
    })
  }
}

pub struct BuildResult;

impl Atlaspack {
  fn state(&mut self) -> anyhow::Result<AtlaspackState> {
    if let Some(state) = self.state.clone() {
      return Ok(state);
    }

    let mut _rpc_connection = None::<RpcWorkerRef>;

    if let Some(rpc_host) = &self.rpc {
      _rpc_connection = Some(rpc_host.start()?);
    }

    let (config, _files) =
      AtlaspackRcConfigLoader::new(Arc::clone(&self.fs), Arc::clone(&self.package_manager)).load(
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
        file_system: self.fs.clone(),
        options: Arc::new(PluginOptions {
          core_path: self.options.core_path.clone(),
          env: self.options.env.clone(),
          log_level: self.options.log_level.clone(),
          mode: self.options.mode.clone(),
          project_root: self.project_root.clone(),
        }),
        // TODO Initialise actual logger
        logger: PluginLogger::default(),
      },
    ));

    let state = AtlaspackState {
      config: config_loader,
      plugins,
    };

    self.state = Some(state.clone());

    Ok(state)
  }

  pub fn build(&mut self) -> anyhow::Result<()> {
    let AtlaspackState { config, plugins } = self.state()?;

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
    let AtlaspackState { config, plugins } = self.state()?;

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
