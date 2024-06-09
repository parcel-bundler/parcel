use dashmap::DashMap;

pub trait Cache: Send + Sync {
  fn has(&self, key: String) -> bool;
  fn get(&self, key: String) -> Option<Vec<u8>>;
  fn set(&self, key: String, value: Vec<u8>);
}

pub struct MemoryCache {
  entries: DashMap<String, Vec<u8>>,
}

impl MemoryCache {
  pub fn new() -> Self {
    MemoryCache {
      entries: DashMap::new(),
    }
  }
}

impl Cache for MemoryCache {
  fn has(&self, key: String) -> bool {
    self.entries.contains_key(&key)
  }

  fn get<'a>(&'a self, key: String) -> Option<Vec<u8>> {
    let entry = self.entries.get(&key);
    entry.map(|e| e.clone())
  }

  fn set(&self, key: String, value: Vec<u8>) {
    self.entries.insert(key, value);
  }
}
