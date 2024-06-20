use std::fmt::Debug;
use std::hash::Hash;
use std::hash::Hasher;
use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::sync::Arc;

use dyn_hash::DynHash;
use parcel_core::config_loader::ConfigLoaderRef;
use parcel_core::types::ParcelOptions;

use crate::plugins::PluginsRef;
use crate::requests::RequestResult;
use parcel_core::cache::CacheRef;
use parcel_core::plugin::ReporterEvent;
use parcel_core::plugin::ReporterPlugin;
use parcel_core::types::Invalidation;
use parcel_filesystem::FileSystemRef;

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
  cache: CacheRef,
  config_loader: ConfigLoaderRef,
  file_system: FileSystemRef,
  options: Arc<ParcelOptions>,
  parent_request_id: Option<u64>,
  plugins: PluginsRef,
  pub project_root: PathBuf,
  reporter: Arc<dyn ReporterPlugin + Send>,
  run_request_fn: RunRequestFn,
}

impl RunRequestContext {
  pub(crate) fn new(
    cache: CacheRef,
    config_loader: ConfigLoaderRef,
    file_system: FileSystemRef,
    options: Arc<ParcelOptions>,
    parent_request_id: Option<u64>,
    plugins: PluginsRef,
    project_root: PathBuf,
    reporter: Arc<dyn ReporterPlugin + Send>,
    run_request_fn: RunRequestFn,
  ) -> Self {
    Self {
      cache,
      config_loader,
      file_system,
      options,
      parent_request_id,
      plugins,
      project_root,
      reporter,
      run_request_fn,
    }
  }

  /// Report an event
  pub fn report(&self, event: ReporterEvent) {
    self
      .reporter
      .report(&event)
      .expect("TODO this should be handled?")
  }

  /// Run a child request to the current request
  #[allow(unused)]
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

  pub fn cache(&self) -> &CacheRef {
    &self.cache
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

  pub fn options(&self) -> &ParcelOptions {
    &self.options
  }
}

// We can type this properly
pub type RunRequestError = anyhow::Error;
pub type RequestId = u64;

pub trait Request: DynHash + Send + Debug + 'static {
  fn id(&self) -> RequestId {
    let mut hasher = parcel_core::hash::IdentifierHasher::default();
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
