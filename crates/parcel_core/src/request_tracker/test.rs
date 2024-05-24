use std::rc::Rc;

use super::request_graph::RequestError;
use super::Request;
use super::RequestResult;
use super::RequestTracker;
use super::RequestTrackerSingleThreaded;
use super::RunRequestContext;

#[test]
fn should_run_request() {
  let request_tracker = TestRequestTracker::new(42);

  let request = RequestA::default();
  let request_c = RequestC::default();

  let result = request_tracker
    .run_request(None, Box::new(request.clone()))
    .unwrap();

  // let result = request_tracker
  //   .run_request(None, Box::new(request_c))
  //   .unwrap();

  // dbg!(&result);
  println!("{:?}", request_tracker);
}

type TestProvide = usize;
type TestRequestTracker = RequestTrackerSingleThreaded<TestRequests, TestProvide>;

#[derive(Debug, Clone)]
enum TestRequests {
  A,
  B,
  C,
}

#[derive(Clone, Debug, Default, Hash)]
struct RequestA {}

impl Request<TestRequests, TestProvide> for RequestA {
  fn run(
    &self,
    ctx: Rc<RunRequestContext<TestRequests, TestProvide>>,
  ) -> Result<RequestResult<TestRequests>, Vec<RequestError>> {
    println!("RequestA.run({})", ctx.provide);

    ctx
      .request_tracker
      .run_request(Some(ctx.clone()), Box::new(RequestB::default()))?;

    ctx
      .request_tracker
      .run_request(Some(ctx.clone()), Box::new(RequestC::default()))?;

    return Ok(RequestResult {
      result: TestRequests::A,
      invalidations: vec![],
    });
  }
}

#[derive(Clone, Debug, Default, Hash)]
struct RequestB {}

impl Request<TestRequests, TestProvide> for RequestB {
  fn run(
    &self,
    ctx: Rc<RunRequestContext<TestRequests, TestProvide>>,
  ) -> Result<RequestResult<TestRequests>, Vec<RequestError>> {
    println!("RequestB.run({})", ctx.provide);
    ctx
      .request_tracker
      .run_request(Some(ctx.clone()), Box::new(RequestC::default()))?;

    return Ok(RequestResult {
      result: TestRequests::B,
      invalidations: vec![],
    });
  }
}

#[derive(Clone, Debug, Default, Hash)]
struct RequestC {}

impl Request<TestRequests, TestProvide> for RequestC {
  fn run(
    &self,
    ctx: Rc<RunRequestContext<TestRequests, TestProvide>>,
  ) -> Result<RequestResult<TestRequests>, Vec<RequestError>> {
    println!("RequestC.run({})", ctx.provide);

    return Ok(RequestResult {
      result: TestRequests::C,
      invalidations: vec![],
    });
  }
}
