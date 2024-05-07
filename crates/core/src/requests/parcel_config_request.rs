use crate::parcel_config::ParcelConfig;
use crate::request_tracker::Request;
use crate::request_tracker::RequestResult;
use crate::worker_farm::WorkerRequest;
use crate::worker_farm::WorkerResult;

#[derive(Hash)]
pub struct ParcelConfigRequest {}

impl Request for ParcelConfigRequest {
  type Output = ParcelConfig;

  fn run(
    &self,
    farm: &crate::worker_farm::WorkerFarm,
  ) -> crate::request_tracker::RequestResult<Self::Output> {
    let WorkerResult::ParcelConfig(config) = farm.run(WorkerRequest::ParcelConfig).unwrap() else {
      unreachable!()
    };

    RequestResult {
      result: Ok(config),
      invalidations: Vec::new(),
    }
  }
}
