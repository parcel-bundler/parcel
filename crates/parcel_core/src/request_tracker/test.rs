// use std::sync::atomic::AtomicUsize;
// use std::sync::atomic::Ordering;
// use std::sync::Arc;

use super::Request;
use super::RequestResult;
use super::RequestTrackerSingleThreaded;

#[test]
fn should_run_request() {
  let mut request_tracker = TestRequestTracker::new();

  let request = FooRequest::default();

  let should_run = request_tracker.start_request(&request);
  if should_run {
    let result = request.run();
    request_tracker.finish_request(request.id(), result.result);
  }
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

use super::{request_graph::RequestError, Request, RequestResult, RequestTracker};

#[derive(Debug, Clone)]
enum TestRequest {
  Foo,
  Bar,
}

#[derive(Default, Hash)]
struct FooRequest {}

impl Request<TestRequest> for FooRequest {
  fn run(
    &self,
    request_tracker: Box<dyn RequestTracker<TestRequest>>,
  ) -> Result<RequestResult<TestRequest>, Vec<RequestError>> {
    request_tracker.run_request(Box::new(FooRequest::default()))
  }
}

// type TestRequestTracker = RequestTrackerSingleThreaded<TestRequest>;
