//! Always include generated napi values
//! Non-canary users will have empty stubs with a no-op

#[cfg(feature = "canary")]
mod sentry;

#[cfg(not(feature = "canary"))]
mod empty_stub;
