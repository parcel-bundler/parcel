use crate::{
  request_tracker::{Request, RequestResult},
  types::{ParcelOptions, Target},
  worker_farm::{WorkerRequest, WorkerResult},
};

use super::entry_request::Entry;

#[derive(Hash, serde::Serialize, Clone, Debug)]
pub struct TargetRequest {
  pub entry: Entry,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TargetRequestResult {
  pub entry: String,
  pub targets: Vec<Target>,
}

impl Request for TargetRequest {
  type Output = TargetRequestResult;

  fn run(
    self,
    farm: &crate::worker_farm::WorkerFarm,
    _options: &ParcelOptions,
  ) -> RequestResult<Self::Output> {
    let entry = self.entry.file_path.clone();
    let WorkerResult::Target {
      targets,
      invalidations,
    } = farm.run(WorkerRequest::Target(self)).unwrap()
    else {
      unreachable!()
    };

    RequestResult {
      result: Ok(TargetRequestResult { entry, targets }),
      invalidations,
    }
  }
}
