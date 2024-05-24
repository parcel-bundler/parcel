// use std::sync::atomic::AtomicUsize;
// use std::sync::atomic::Ordering;
// use std::sync::Arc;

use super::request_graph::RequestError;
use super::Request;
use super::RequestResult;
use super::RequestTracker;
use super::RequestTrackerSingleThreaded;

#[test]
fn should_run_request() {
  let request_tracker = TestRequestTracker::new(42);

  let request = RequestA::default();

  let result = request_tracker
    .run_request(Box::new(request.clone()))
    .unwrap();

  dbg!(&result);
}

// #[test]
// fn should_replay_request() {
//   let mut request_tracker = TestRequestTracker::new();

//   let request_1 = FooRequest::default();

//   let should_run = request_tracker.start_request(&request_1);
//   assert!(should_run, "Should run request");
//   if should_run {
//     let result = request_1.run();
//     request_tracker.finish_request(request_1.id(), result.result);
//   }

//   let request_2 = FooRequest::default();

//   let should_run = request_tracker.start_request(&request_2);
//   assert!(!should_run, "Should not run request");
//   if should_run {
//     let result = request_2.run();
//     request_tracker.finish_request(request_2.id(), result.result);
//   }

//   assert!(
//     request_1.runs.load(Ordering::Relaxed) == 1,
//     "Should run once"
//   );
//   assert!(
//     request_2.runs.load(Ordering::Relaxed) == 0,
//     "Should never run"
//   );
// }

// use std::sync::Arc;

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
    request_tracker: Box<dyn RequestTracker<TestRequests, TestProvide>>,
    provide: TestProvide,
  ) -> Result<RequestResult<TestRequests>, Vec<RequestError>> {
    println!("RequestA.run({})", provide);
    request_tracker.run_request(Box::new(RequestB::default()))?;

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
    request_tracker: Box<dyn RequestTracker<TestRequests, TestProvide>>,
    provide: TestProvide,
  ) -> Result<RequestResult<TestRequests>, Vec<RequestError>> {
    println!("RequestB.run({})", provide);
    request_tracker.run_request(Box::new(RequestC::default()))?;

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
    _request_tracker: Box<dyn RequestTracker<TestRequests, TestProvide>>,
    provide: TestProvide,
  ) -> Result<RequestResult<TestRequests>, Vec<RequestError>> {
    println!("RequestC.run({})", provide);

    return Ok(RequestResult {
      result: TestRequests::C,
      invalidations: vec![],
    });
  }
}
