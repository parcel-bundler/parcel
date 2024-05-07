use super::Entry;
use crate::request_tracker::Request;
use crate::request_tracker::RequestResult;
use crate::worker_farm::WorkerRequest;
use crate::worker_farm::WorkerResult;

#[derive(Hash, serde::Serialize, Clone, Debug)]
pub struct EntryRequest {
  pub entry: String,
}

impl Request for EntryRequest {
  type Output = Vec<Entry>;

  fn run(&self, farm: &crate::worker_farm::WorkerFarm) -> RequestResult<Self::Output> {
    let WorkerResult::Entry(entries) = farm.run(WorkerRequest::Entry(self.clone())).unwrap() else {
      unreachable!()
    };

    RequestResult {
      result: Ok(entries),
      invalidations: Vec::new(),
    }
  }
}
