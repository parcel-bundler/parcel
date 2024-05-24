// use std::sync::atomic::AtomicUsize;
// use std::sync::atomic::Ordering;
// use std::sync::Arc;

// use super::Request;
// use super::RequestResult;
// use super::RequestTrackerSingleThreaded;

// #[test]
// fn should_run_request() {
//   let mut request_tracker = TestRequestTracker::new();

//   let request = FooRequest::default();

//   let should_run = request_tracker.start_request(&request);
//   if should_run {
//     let result = request.run();
//     request_tracker.finish_request(request.id(), result.result);
//   }
// }

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

// #[derive(Debug, Clone)]
// enum TestRequest {
//   Foo,
//   Bar,
// }

// #[derive(Default)]
// struct FooRequest {
// }

// impl std::hash::Hash for FooRequest {
//   fn hash<H: std::hash::Hasher>(&self, _state: &mut H) {
//     // exclude runs from hash
//   }
// }

// impl Request<TestRequest> for FooRequest {
//   fn run(&self) -> RequestResult<TestRequest> {
//     RequestResult {
//       result: Ok(TestRequest::Foo),
//       invalidations: vec![],
//     }
//   }
// }

// type TestRequestTracker = RequestTrackerSingleThreaded<TestRequest>;
