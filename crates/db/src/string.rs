use std::io::Write;
use std::num::NonZeroU32;

use dashmap::DashMap;
use parcel_derive::SlabAllocated;

use crate::{
  atomics::AtomicVec,
  codegen::{JsValue, ToJs},
  current_db,
  slab::SlabAllocated,
  ArenaAllocated,
};

/// An InternedString is a string that only ever exists once.
/// This means it is extremely cheap to clone, compare, hash, etc.
#[derive(PartialEq, Eq, Clone, Copy, PartialOrd, Ord, Hash, SlabAllocated)]
pub struct InternedString(pub NonZeroU32);

impl From<String> for InternedString {
  fn from(value: String) -> Self {
    let strings = &current_db().strings;
    if let Some(v) = strings.get(value.as_str()) {
      return v;
    }

    strings.add(value)
  }
}

impl From<&str> for InternedString {
  fn from(value: &str) -> Self {
    let strings = &current_db().strings;
    if let Some(v) = strings.get(value) {
      return v;
    }

    strings.add(String::from(value))
  }
}

impl InternedString {
  pub fn get(s: &str) -> Option<InternedString> {
    current_db().strings.get(s)
  }

  pub fn as_str(&self) -> &'static str {
    current_db().strings.get_str(self)
  }
}

impl AsRef<str> for &InternedString {
  fn as_ref(&self) -> &str {
    self.as_str()
  }
}

impl<T: AsRef<str>> PartialEq<T> for InternedString {
  fn eq(&self, other: &T) -> bool {
    matches!(InternedString::get(other.as_ref()), Some(s) if s == *self)
  }
}

impl core::ops::Deref for InternedString {
  type Target = str;

  fn deref(&self) -> &str {
    self.as_str()
  }
}

impl std::fmt::Debug for InternedString {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.as_str().fmt(f)
  }
}

impl std::fmt::Display for InternedString {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.as_str().fmt(f)
  }
}

impl Default for InternedString {
  fn default() -> Self {
    String::default().into()
  }
}

impl JsValue for InternedString {
  fn js_getter(db: &str, addr: &str, offset: usize) -> String {
    format!(
      "readCachedString({}, readU32({}, {} + {}))",
      db, db, addr, offset
    )
  }

  fn js_setter(db: &str, addr: &str, offset: usize, value: &str) -> String {
    // STRING_CACHE.set(this.addr + {addr}, {value});
    format!(
      "writeU32({}, {} + {}, {}.getStringId({}))",
      db, addr, offset, db, value
    )
  }

  fn ty() -> String {
    "string".into()
  }

  fn accessor() -> String {
    "InternedString".into()
  }
}

impl ToJs for InternedString {
  fn to_js() -> String {
    let id = crate::codegen::type_id::<InternedString>();
    format!(
      r#"class InternedString {{
  static typeId: number = {id};

  static get(db: ParcelDb, addr: number): string {{
    return readCachedString(db, readU32(db, addr));
  }}

  static set(db: ParcelDb, addr: number, value: string): void {{
    writeU32(db, addr, db.getStringId(value));
  }}
}}
"#,
      id = id
    )
  }
}

#[ctor::ctor]
unsafe fn register() {
  crate::codegen::WRITE_CALLBACKS.push(|file| write!(file, "{}", InternedString::to_js()));
  crate::codegen::register_type::<InternedString>(crate::codegen::Factory {
    alloc: InternedString::alloc_ptr,
    dealloc: InternedString::dealloc_ptr,
    extend_vec: InternedString::extend_vec,
  });
}

/// A StringInterner stores the contents of InternedStrings.
/// When it is dropped, all InternedStrings are also dropped.
pub struct StringInterner {
  strings: AtomicVec<&'static str>,
  lookup: DashMap<&'static str, NonZeroU32>,
}

unsafe impl Send for StringInterner {}

impl StringInterner {
  pub fn new() -> Self {
    Self {
      strings: AtomicVec::new(),
      lookup: DashMap::new(),
    }
  }

  fn add(&self, value: String) -> InternedString {
    let mut bytes = value.into_bytes();
    bytes.shrink_to_fit();
    let s = unsafe { std::str::from_utf8_unchecked(bytes.leak()) };
    let id = self.strings.push(s);
    let offset = unsafe { NonZeroU32::new_unchecked(id + 1) };
    self.lookup.insert(s, offset);
    InternedString(offset)
  }

  fn get(&self, s: &str) -> Option<InternedString> {
    if let Some(v) = self.lookup.get(s) {
      return Some(InternedString(*v));
    }

    None
  }

  fn get_str(&self, id: &InternedString) -> &str {
    unsafe { self.strings.get_unchecked(id.0.get() - 1) }
  }

  pub fn write<W: std::io::Write>(&self, dest: &mut W) -> std::io::Result<()> {
    dest.write(&u32::to_le_bytes(self.strings.len()))?;
    for i in 0..self.strings.len() {
      let buf = self.strings.get(i).unwrap().as_bytes();
      dest.write(&u32::to_le_bytes(buf.len() as u32))?;
      dest.write(buf)?;
    }
    Ok(())
  }

  pub fn read<R: std::io::Read>(source: &mut R) -> std::io::Result<StringInterner> {
    let mut buf: [u8; 4] = [0; 4];
    source.read_exact(&mut buf)?;
    let len = u32::from_le_bytes(buf);
    let res = StringInterner::new();
    for _ in 0..len {
      source.read_exact(&mut buf)?;
      let len = u32::from_le_bytes(buf);
      let mut vec = std::vec::Vec::with_capacity(len as usize);
      unsafe { vec.set_len(len as usize) };
      source.read_exact(&mut vec)?;
      let string = String::from_utf8(vec)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid UTF-8"))?;
      res.add(string);
    }
    Ok(res)
  }
}

impl Drop for StringInterner {
  fn drop(&mut self) {
    unsafe {
      for i in 0..self.strings.len() {
        let s = self.strings.get_unchecked(i);
        let vec = Vec::from_raw_parts(s.as_ptr() as *mut u8, s.len(), s.len());
        drop(vec)
      }
    }
  }
}
