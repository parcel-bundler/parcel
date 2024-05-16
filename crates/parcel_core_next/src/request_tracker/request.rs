use std::collections::hash_map::DefaultHasher;
use std::hash::Hash;
use std::hash::Hasher;

pub trait Request: Hash + Sync {
  type Output: Send + Clone;

  fn id(&self) -> u64 {
    let mut hasher = DefaultHasher::new();
    std::any::type_name::<Self>().hash(&mut hasher); // ???
    self.hash(&mut hasher);
    hasher.finish()
  }

  fn run(&self) -> RequestResult<Self::Output>;
}

pub trait StoreRequestOutput: Request {
  fn store(output: Self::Output) -> RequestOutput;
  fn retrieve(output: &RequestOutput) -> &Self::Output;
}

pub struct RequestResult<Output> {
  pub result: Result<Output, RequestError>,
  pub invalidations: Vec<Invalidation>,
}

#[derive(Clone, Debug)]
pub enum RequestError {}

#[derive(Debug)]
pub enum RequestOutput {
  ParcelBuildRequest,
  BundleGraphRequest,
  AssetGraphRequest,
  EntryRequest,
  TargetRequest,
  ParcelConfigRequest,
  PathRequest,
  DevDepRequest,
  AssetRequest,
  ConfigRequest,
  WriteBundlesRequest,
  PackageRequest,
  WriteBundleRequest,
  ValidationRequest,
}

pub enum Invalidation {}
