use crate::{
  request_tracker::{Request, RequestResult},
  types::{ParcelOptions, Target},
  worker_farm::{WorkerRequest, WorkerResult},
};

use super::entry_request::Entry;

#[derive(Hash, serde::Serialize, Clone, Debug)]
pub struct TargetRequest<'a> {
  pub entry: Entry,
  pub named_pipelines: &'a Vec<&'a str>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TargetRequestResult {
  pub entry: String,
  pub targets: Vec<Target>,
}

impl<'a> Request for TargetRequest<'a> {
  type Output = TargetRequestResult;

  fn run(
    self,
    farm: &crate::worker_farm::WorkerFarm,
    _options: &ParcelOptions,
  ) -> RequestResult<Self::Output> {
    let entry = self.entry.file_path.clone();
    let WorkerResult::Target {
      mut targets,
      invalidations,
    } = farm.run(WorkerRequest::Target(self.entry)).unwrap()
    else {
      unreachable!()
    };

    // Find named pipelines for each target.
    for target in &mut targets {
      if self.named_pipelines.contains(&target.name.as_str()) {
        target.pipeline = Some(target.name.clone());
      }
    }

    RequestResult {
      result: Ok(TargetRequestResult { entry, targets }),
      invalidations,
    }
  }
}
