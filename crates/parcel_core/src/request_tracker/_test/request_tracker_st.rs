use super::super::RequestTrackerSingleThreaded;
use super::TestProvide;
use super::TestRequest;
use super::TestRequestResult;
use crate::request_tracker::RequestTracker;

type TestRequestTracker = RequestTrackerSingleThreaded<TestRequestResult, TestProvide>;

#[test]
fn should_run_request() {
  let request_tracker = TestRequestTracker::new(TestProvide {});

  let request_a = TestRequest::new("A", TestRequestResult::A, &[]);

  request_tracker
    .run_request(None, request_a.clone())
    .unwrap();

  assert!(
    request_a.run_count() == 1,
    "Expected request to run 1 time, got {}",
    request_a.run_count()
  );
}

#[test]
fn should_run_request_2() {
  let request_tracker = TestRequestTracker::new(TestProvide {});

  let request_b = TestRequest::new("B", TestRequestResult::B, &[]);
  let request_a = TestRequest::new("A", TestRequestResult::A, &[request_b.clone()]);

  request_tracker
    .run_request(None, request_a.clone())
    .unwrap();

  assert!(
    request_a.run_count() == 1,
    "Expected request to run 1 time, got {}",
    request_a.run_count()
  );
  assert!(
    request_b.run_count() == 1,
    "Expected request to run 1 time, got {}",
    request_b.run_count()
  );
}

#[test]
fn should_run_request_3() {
  let request_tracker = TestRequestTracker::new(TestProvide {});

  let request_c = TestRequest::new("C", TestRequestResult::C, &[]);
  let request_b = TestRequest::new("B", TestRequestResult::B, &[request_c.clone()]);
  let request_a = TestRequest::new("A", TestRequestResult::A, &[request_b.clone()]);

  request_tracker
    .run_request(None, request_a.clone())
    .unwrap();

  assert!(
    request_a.run_count() == 1,
    "Expected request to run 1 time, got {}",
    request_a.run_count()
  );
  assert!(
    request_b.run_count() == 1,
    "Expected request to run 1 time, got {}",
    request_b.run_count()
  );
  assert!(
    request_c.run_count() == 1,
    "Expected request to run 1 time, got {}",
    request_c.run_count()
  );
}

#[test]
fn should_run_request_4() {
  let request_tracker = TestRequestTracker::new(TestProvide {});

  let request_c = TestRequest::new("C", TestRequestResult::C, &[]);
  let request_b = TestRequest::new("B", TestRequestResult::B, &[request_c.clone()]);
  let request_a = TestRequest::new("A", TestRequestResult::A, &[request_b.clone()]);

  request_tracker
    .run_request(None, request_a.clone())
    .unwrap();

  request_tracker
    .run_request(None, request_b.clone())
    .unwrap();

  assert!(
    request_a.run_count() == 1,
    "Expected request to run 1 time, got {}",
    request_a.run_count()
  );
  assert!(
    request_b.run_count() == 1,
    "Expected request to run 1 time, got {}",
    request_b.run_count()
  );
  assert!(
    request_c.run_count() == 1,
    "Expected request to run 1 time, got {}",
    request_c.run_count()
  );
}
