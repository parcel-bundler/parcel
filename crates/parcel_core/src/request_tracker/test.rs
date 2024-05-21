use super::request;
use super::request_tracker::RequestTracker;
use super::Request;
use super::RequestResult;
// use super::RequestTrackerSingleThread;

#[derive(Debug, Clone)]
enum TestRequest {
  Foo(usize),
  Bar,
}

#[derive(Hash)]
struct FooRequest {}

impl Request<TestRequest> for FooRequest {
  fn run(&self) -> RequestResult<TestRequest> {
    RequestResult {
      result: Ok(TestRequest::Foo(1)),
      invalidations: vec![],
    }
  }
}

// #[test]
// fn should_run_request() {
//   let provide = 42;
//   let mut request_tracker =
//     RequestTrackerSingleThread::<TestRequest, TestDependencies>::new(provide);

//   let request = FooRequest {};
//   request_tracker.run_request(request);
// }

// #[test]
// fn two() {}
