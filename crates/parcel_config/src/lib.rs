pub mod config_error;
pub mod parcel_config;
#[cfg(test)]
mod parcel_config_fixtures;
pub mod parcel_rc;
pub mod parcel_rc_config_loader;
mod partial_parcel_config;
pub mod pipeline;

pub use parcel_config::ParcelConfig;
pub use parcel_config::PluginNode;
