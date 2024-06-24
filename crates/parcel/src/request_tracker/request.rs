use std::fmt::Debug;
use std::hash::DefaultHasher;
use std::hash::Hash;
use std::hash::Hasher;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;

use dyn_hash::DynHash;

use crate::plugins::PluginsRef;
use parcel_core::cache::CacheRef;
use parcel_core::plugin::{ReporterEvent, ReporterPlugin};
use parcel_core::types::Invalidation;
use parcel_filesystem::FileSystemRef;

#[derive(Debug)]
pub struct RunRequestMessage<T> {
  pub request: Box<dyn Request<T>>,
  pub parent_request_id: Option<u64>,
  pub response_tx: Option<Sender<Result<T, anyhow::Error>>>,
}

type RunRequestFn<T> = Box<dyn Fn(RunRequestMessage<T>) + Send>;

pub struct RunRequestContext<T> {
  parent_request_id: Option<u64>,
  run_request_fn: RunRequestFn<T>,
  reporter: Arc<dyn ReporterPlugin + Send>,
  cache: CacheRef,
  file_system: FileSystemRef,
  plugins: PluginsRef,
}

impl<T: Clone + Send> RunRequestContext<T> {
  pub(crate) fn new(
    parent_request_id: Option<u64>,
    run_request_fn: RunRequestFn<T>,
    reporter: Arc<dyn ReporterPlugin + Send>,
    cache: CacheRef,
    file_system: FileSystemRef,
    plugins: PluginsRef,
  ) -> Self {
    Self {
      parent_request_id,
      run_request_fn,
      reporter,
      cache,
      file_system,
      plugins,
    }
  }

  pub fn report(&self, event: ReporterEvent) {
    self
      .reporter
      .report(&event)
      .expect("TODO this should be handled?")
  }

  pub fn queue_request(
    &mut self,
    request: impl Request<T>,
    tx: Sender<anyhow::Result<T>>,
  ) -> anyhow::Result<()> {
    let request: Box<dyn Request<T>> = Box::new(request);
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
}

// We can type this properly
pub type RunRequestError = anyhow::Error;

pub trait Request<T: Clone>: DynHash + Send + Debug + 'static {
  fn id(&self) -> u64 {
    let mut hasher = DefaultHasher::default();
    std::any::type_name::<Self>().hash(&mut hasher);
    self.dyn_hash(&mut hasher);
    hasher.finish()
  }

  fn run(
    &self,
    request_context: RunRequestContext<T>,
  ) -> Result<ResultAndInvalidations<T>, RunRequestError>;
}

dyn_hash::hash_trait_object!(<T: Clone> Request<T>);

#[derive(Debug, Clone, PartialEq)]
pub struct ResultAndInvalidations<Req> {
  pub result: Req,
  pub invalidations: Vec<Invalidation>,
}

#[derive(Debug, Clone)]
pub enum RequestError {
  Impossible,
}
