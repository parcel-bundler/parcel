use std::collections::HashMap;

use crate::plugin::ResolverPlugin;
use crate::plugin::TransformerPlugin;

#[derive(Default)]
pub struct PluginContainer {
  resolvers: HashMap<String, Box<dyn ResolverPlugin>>,
  transformers: HashMap<String, Box<dyn TransformerPlugin>>,
}
