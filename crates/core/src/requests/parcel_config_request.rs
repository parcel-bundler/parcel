use crate::{
  parcel_config::ParcelConfig,
  request_tracker::{Request, RequestResult},
  types::ParcelOptions,
  worker_farm::{WorkerRequest, WorkerResult},
};

#[derive(Hash)]
pub struct ParcelConfigRequest {}

impl Request for ParcelConfigRequest {
  type Output = ParcelConfig;

  fn run(
    &self,
    farm: &crate::worker_farm::WorkerFarm,
    options: &ParcelOptions,
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
