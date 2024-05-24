use std::sync::atomic::AtomicUsize;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::sync::Mutex;

use super::super::Request;
use super::super::RequestError;
use super::super::RequestResult;
use super::super::RunRequestContext;

#[derive(Default, Debug, Clone)]
pub enum TestRequestResult {
  #[default]
  A,
  B,
  C,
}

#[derive(Clone)]
pub struct TestProvide {}

#[derive(Clone, Default)]
pub struct TestRequest {
  name: String,
  result: TestRequestResult,
  runs: Arc<AtomicUsize>,
  subrequets: Arc<Mutex<Vec<Arc<TestRequest>>>>,
}

impl std::hash::Hash for TestRequest {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    self.name.hash(state);
  }
}

impl std::fmt::Debug for TestRequest {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "Request({})", &self.name)
  }
}

impl TestRequest {
  pub fn new<T: AsRef<str>>(
    name: T,
    result: TestRequestResult,
    subrequests: &[Arc<TestRequest>],
  ) -> Arc<Self> {
    Arc::new(Self {
      name: name.as_ref().to_string(),
      result,
      runs: Default::default(),
      subrequets: Arc::new(Mutex::new(subrequests.to_owned())),
    })
  }

  pub fn run_count(&self) -> usize {
    self.runs.load(Ordering::Relaxed)
  }
}

impl Request<TestRequestResult, TestProvide> for TestRequest {
  fn run(
    &self,
    ctx: Arc<RunRequestContext<TestRequestResult, TestProvide>>,
  ) -> Result<RequestResult<TestRequestResult>, Vec<RequestError>> {
    self.runs.fetch_add(1, Ordering::Relaxed);

    for subrequest in self.subrequets.lock().unwrap().iter() {
      ctx
        .request_tracker
        .run_request(Some(ctx.clone()), subrequest.clone())?;
    }

    return Ok(RequestResult {
      result: self.result.clone(),
      invalidations: vec![],
    });
  }
}
