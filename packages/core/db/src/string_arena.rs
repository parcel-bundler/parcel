use std::collections::HashMap;

// https://matklad.github.io/2020/03/22/fast-simple-rust-interner.html
#[derive(Default)]
pub struct StringArena {
  map: HashMap<&'static str, u32>,
  vec: Vec<&'static str>,
  buf: String,
  full: Vec<String>,
}

impl StringArena {
  pub fn with_capacity(cap: usize) -> Self {
    let cap = cap.next_power_of_two();
    Self {
      map: HashMap::default(),
      vec: Vec::new(),
      buf: String::with_capacity(cap),
      full: Vec::new(),
    }
  }

  pub fn intern(&mut self, name: &str) -> u32 {
    if let Some(&id) = self.map.get(name) {
      return id;
    }
    let name = unsafe { self.alloc(name) };
    let id = self.map.len() as u32;
    self.map.insert(name, id);
    self.vec.push(name);
    // println!("ADD {}", name);

    debug_assert!(self.lookup(id) == name);
    debug_assert!(self.intern(name) == id);

    id
  }

  pub fn lookup(&self, id: u32) -> &str {
    self.vec[id as usize]
  }

  unsafe fn alloc(&mut self, name: &str) -> &'static str {
    let cap = self.buf.capacity();
    if cap < self.buf.len() + name.len() {
      let new_cap = (cap.max(name.len()) + 1).next_power_of_two();
      let new_buf = String::with_capacity(new_cap);
      let old_buf = std::mem::replace(&mut self.buf, new_buf);
      self.full.push(old_buf);
    }

    let interned = {
      let start = self.buf.len();
      self.buf.push_str(name);
      &self.buf[start..]
    };

    &*(interned as *const str)
  }
}
