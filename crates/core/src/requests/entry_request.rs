use crate::request_tracker::{Request, RequestResult};

#[derive(Hash)]
pub struct EntryRequest {
  pub entry: String,
}

#[derive(Clone, Debug)]
pub struct Entry {
  pub file_path: String,
  pub package_path: String,
  pub target: Option<String>,
  // loc
}

impl Request for EntryRequest {
  type Output = Vec<Entry>;

  fn run(&self, _farm: &crate::worker_farm::WorkerFarm) -> RequestResult<Self::Output> {
    // todo!()
    RequestResult {
      result: Ok(vec![Entry {
        file_path: self.entry.clone(),
        package_path: "/".into(),
        target: None,
      }]),
      invalidations: Vec::new(),
    }
  }
}
