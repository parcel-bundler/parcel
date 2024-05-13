use crate::{
  request_tracker::{Request, RequestResult},
  types::ParcelOptions,
  worker_farm::{WorkerRequest, WorkerResult},
};

#[derive(Hash, serde::Serialize, Clone, Debug)]
pub struct EntryRequest {
  pub entry: String,
}

#[derive(Clone, Debug, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
  pub file_path: String,
  pub package_path: String,
  pub target: Option<String>,
  // loc
}

impl Request for EntryRequest {
  type Output = Vec<Entry>;

  fn run(
    self,
    farm: &crate::worker_farm::WorkerFarm,
    options: &ParcelOptions,
  ) -> RequestResult<Self::Output> {
    let WorkerResult::Entry(entries) = farm.run(WorkerRequest::Entry(self)).unwrap() else {
      unreachable!()
    };

    RequestResult {
      result: Ok(entries),
      invalidations: Vec::new(),
    }
  }
}
