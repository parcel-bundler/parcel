use std::fmt::Debug;
use std::hash::Hash;
use std::hash::Hasher;
use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::sync::Arc;

use atlaspack_core::config_loader::ConfigLoaderRef;
use atlaspack_core::types::AtlaspackOptions;
use dyn_hash::DynHash;

use crate::plugins::PluginsRef;
use crate::requests::RequestResult;
use atlaspack_core::plugin::ReporterEvent;
use atlaspack_core::types::Invalidation;
use atlaspack_filesystem::FileSystemRef;

#[derive(Debug)]
pub struct RunRequestMessage {
  pub request: Box<dyn Request>,
  pub parent_request_id: Option<u64>,
  pub response_tx: Option<Sender<Result<(RequestResult, RequestId), anyhow::Error>>>,
}

type RunRequestFn = Box<dyn Fn(RunRequestMessage) + Send>;

/// This is the API for requests to call back onto the `RequestTracker`.
///
/// We want to avoid exposing internals of the request tracker to the implementations so that we
/// can change this.
pub struct RunRequestContext {
  config_loader: ConfigLoaderRef,
  file_system: FileSystemRef,
  pub options: Arc<AtlaspackOptions>,
  parent_request_id: Option<u64>,
  plugins: PluginsRef,
  pub project_root: PathBuf,
  run_request_fn: RunRequestFn,
}

impl RunRequestContext {
  pub(crate) fn new(
    config_loader: ConfigLoaderRef,
    file_system: FileSystemRef,
    options: Arc<AtlaspackOptions>,
    parent_request_id: Option<u64>,
    plugins: PluginsRef,
    project_root: PathBuf,
    run_request_fn: RunRequestFn,
  ) -> Self {
    Self {
      config_loader,
      file_system,
      options,
      parent_request_id,
      plugins,
      project_root,
      run_request_fn,
    }
  }

  /// Report an event
  pub fn report(&self, event: ReporterEvent) {
    self
      .plugins()
      .reporter()
      .report(&event)
      .expect("TODO this should be handled?")
  }

  /// Run a child request to the current request
  pub fn queue_request(
    &mut self,
    request: impl Request,
    tx: Sender<anyhow::Result<(RequestResult, RequestId)>>,
  ) -> anyhow::Result<()> {
    let request: Box<dyn Request> = Box::new(request);
    let message = RunRequestMessage {
      request,
      response_tx: Some(tx),
      parent_request_id: self.parent_request_id,
    };
    (*self.run_request_fn)(message);
    Ok(())
  }

  pub fn file_system(&self) -> &FileSystemRef {
    &self.file_system
  }

  pub fn plugins(&self) -> &PluginsRef {
    &self.plugins
  }

  pub fn config(&self) -> &ConfigLoaderRef {
    &self.config_loader
  }
}

// We can type this properly
pub type RunRequestError = anyhow::Error;
pub type RequestId = u64;

pub trait Request: DynHash + Send + Debug + 'static {
  fn id(&self) -> RequestId {
    let mut hasher = atlaspack_core::hash::IdentifierHasher::default();
    std::any::type_name::<Self>().hash(&mut hasher);
    self.dyn_hash(&mut hasher);
    hasher.finish()
  }

  fn run(
    &self,
    request_context: RunRequestContext,
  ) -> Result<ResultAndInvalidations, RunRequestError>;
}

dyn_hash::hash_trait_object!(Request);

#[derive(Debug, Clone, PartialEq)]
pub struct ResultAndInvalidations {
  pub result: RequestResult,
  pub invalidations: Vec<Invalidation>,
}
