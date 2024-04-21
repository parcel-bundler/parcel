use crate::{
  request_tracker::{Request, RequestResult},
  types::Target,
  worker_farm::{WorkerRequest, WorkerResult},
};

use super::entry_request::Entry;

#[derive(Hash, serde::Serialize, Clone, Debug)]
pub struct TargetRequest {
  pub entry: Entry,
}

impl Request for TargetRequest {
  type Output = Vec<Target>;

  fn run(&self, farm: &crate::worker_farm::WorkerFarm) -> RequestResult<Self::Output> {
    let WorkerResult::Target(targets) = farm.run(WorkerRequest::Target(self.clone())).unwrap()
    else {
      unreachable!()
    };

    RequestResult {
      result: Ok(targets),
      invalidations: Vec::new(),
    }
  }
}
