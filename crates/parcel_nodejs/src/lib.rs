#![deny(unused_crate_dependencies)]

// Old parcel implementation, will be replaced with Parcel v3.
// Anything that can be reused will be migrated over
mod parcel_v2;

// Parcel Rust
mod file_system;
mod helpers;
mod parcel;

#[cfg(all(target_os = "macos", not(miri)))]
#[global_allocator]
static GLOBAL: jemallocator::Jemalloc = jemallocator::Jemalloc;

#[cfg(all(windows, not(miri)))]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;
