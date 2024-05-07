use crate::request_tracker::requests::entry_request::Entry;
use crate::request_tracker::Request;
use crate::request_tracker::RequestResult;
use crate::types::Target;
use crate::worker_farm::WorkerRequest;
use crate::worker_farm::WorkerResult;

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
