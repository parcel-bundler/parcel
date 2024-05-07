/*
  This module contains the implementation for the request tracker.

  The request tracker is responsible for coordinating bundling events
  known as "requests".

  These "requests" contain the logic for tasks like
  calling plugins.

  This is vital for caching as requests are stored in the cache and
  replayed if they have already been dispatched
*/
mod request_tracker;
pub mod requests;

pub use self::request_tracker::*;
