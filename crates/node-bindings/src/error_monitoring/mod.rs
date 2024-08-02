//! This wraps error monitoring modules:
//!
//! * Sentry used for error/panic reporting
//!
//! Non-canary users will have empty stubs with a no-op

#[cfg(feature = "canary")]
mod implementation;

#[cfg(not(feature = "canary"))]
mod empty_stub;
