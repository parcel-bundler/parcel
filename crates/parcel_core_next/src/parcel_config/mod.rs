/*
  This module contains the logic for parsing the Parcel config file.
  By default that is the .parcelrc
*/
mod parcel_config;
mod pipeline_map;
mod pipeline_node;
mod plugin_node;

pub use self::parcel_config::*;
pub use self::pipeline_map::*;
pub use self::pipeline_node::*;
pub use self::plugin_node::*;
