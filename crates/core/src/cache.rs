use dashmap::DashMap;
use std::ops::Deref;

pub struct Cache {
  entries: DashMap<String, Vec<u8>>,
}

impl Cache {
  pub fn new() -> Self {
    Cache {
      entries: DashMap::new(),
    }
  }

  pub fn has(&self, key: String) -> bool {
    self.entries.contains_key(&key)
  }

  pub fn get<'a>(&'a self, key: String) -> Option<impl Deref<Target = Vec<u8>> + 'a> {
    self.entries.get(&key)
  }

  pub fn set(&self, key: String, value: Vec<u8>) {
    self.entries.insert(key, value);
  }
}
