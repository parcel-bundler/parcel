rt.start_request_queue(|queue| {
  queue.run_request();

  for result in queue.handle_result() {

  }
});


