use std::num::NonZeroU32;

// Callbacks to write generated JS to a file.
pub static mut WRITE_CALLBACKS: Vec<fn(&mut std::fs::File) -> std::io::Result<()>> = Vec::new();

/// A mapping of indices to type ids used during code generation for alloc/dealloc methods.
pub static mut TYPES: Vec<&'static str> = Vec::new();

// A mapping from type ids (indices) to factories to alloc/dealloc that type.
static mut FACTORIES: Vec<Factory> = Vec::new();

/// A factory allocates or deallocates values of a certain type.
pub struct Factory {
  pub alloc: fn() -> u32,
  pub dealloc: fn(u32),
  pub extend_vec: fn(u32, u32),
}

pub fn register_type<T: 'static>(factory: Factory) {
  // use type_name rather than TypeId here because it is consistent between builds.
  let type_name = std::any::type_name::<T>();

  unsafe {
    // Insert into sorted arrays so the mapped indices are consistent.
    match TYPES.binary_search(&type_name) {
      Ok(_) => unreachable!("duplicate type registration"),
      Err(pos) => {
        TYPES.insert(pos, type_name);
        FACTORIES.insert(pos, factory);
      }
    }
  }
}

pub fn type_id<T: 'static>() -> u32 {
  unsafe {
    TYPES
      .iter()
      .position(|t| *t == std::any::type_name::<T>())
      .unwrap() as u32
  }
}

pub fn get_factory(type_id: u32) -> &'static Factory {
  // SAFETY: FACTORIES is not mutated after initial registration.
  unsafe { &FACTORIES[type_id as usize] }
}

/// A trait for types that can generate JS accessor code.
pub trait ToJs {
  fn to_js() -> String;
}

/// A trait for types that can be accessed from JS getters and setters.
pub trait JsValue {
  /// Generates JS source code for a getter that reads a value of this type at the given address.
  fn js_getter(db: &str, addr: &str, offset: usize) -> String;

  /// Generates JS source code for a setter that writes a value of this type at the given address.
  fn js_setter(db: &str, addr: &str, offset: usize, value: &str) -> String;

  /// A Flow type name for this type of value.
  fn ty() -> String;

  /// An accessor type for this type of value when used in a Vec.
  /// The default implementation returns the same thing as Self::ty().
  fn accessor() -> String {
    Self::ty()
  }
}

impl JsValue for u8 {
  fn js_getter(db: &str, addr: &str, offset: usize) -> String {
    format!("readU8({}, {} + {})", db, addr, offset)
  }

  fn js_setter(db: &str, addr: &str, offset: usize, value: &str) -> String {
    format!("writeU8({}, {} + {}, {})", db, addr, offset, value)
  }

  fn ty() -> String {
    "number".into()
  }
}

impl JsValue for u32 {
  fn js_getter(db: &str, addr: &str, offset: usize) -> String {
    format!("readU32({}, {} + {})", db, addr, offset)
  }

  fn js_setter(db: &str, addr: &str, offset: usize, value: &str) -> String {
    format!("writeU32({}, {} + {}, {})", db, addr, offset, value)
  }

  fn ty() -> String {
    "number".into()
  }
}

impl JsValue for NonZeroU32 {
  fn js_getter(db: &str, addr: &str, offset: usize) -> String {
    format!("readU32({}, {} + {})", db, addr, offset)
  }

  fn js_setter(db: &str, addr: &str, offset: usize, value: &str) -> String {
    format!("writeU32({}, {} + {}, {})", db, addr, offset, value)
  }

  fn ty() -> String {
    "number".into()
  }
}

impl JsValue for bool {
  fn js_getter(db: &str, addr: &str, offset: usize) -> String {
    format!("!!readU8({}, {} + {})", db, addr, offset)
  }

  fn js_setter(db: &str, addr: &str, offset: usize, value: &str) -> String {
    format!("writeU8({}, {} + {}, {} ? 1 : 0)", db, addr, offset, value)
  }

  fn ty() -> String {
    "boolean".into()
  }
}

/// Returns uninitialized memory for a type. Ensures that all bytes are non-zero.
/// Private. Used by derive.
pub fn uninit<T>() -> T {
  let mut v = std::mem::MaybeUninit::<T>::uninit();
  let slice =
    unsafe { std::slice::from_raw_parts_mut(v.as_mut_ptr() as *mut u8, std::mem::size_of::<T>()) };
  for b in slice {
    *b = 123;
  }
  unsafe { v.assume_init() }
}

/// Returns the offset of the value in an enum.
/// Private. Used by derive.
pub fn enum_value_offset<T, U, Wrap: Fn(T) -> U, Unwrap: Fn(&U) -> &T>(
  wrap: Wrap,
  unwrap: Unwrap,
) -> usize {
  let v = wrap(uninit::<T>());
  let base = &v as *const _ as usize;
  let offset = (unwrap(&v) as *const _ as usize) - base;
  std::mem::forget(v);
  offset
}

fn option_offset<T>() -> usize {
  enum_value_offset::<T, _, _, _>(Some, |v| v.as_ref().unwrap())
}

/// Returns the offset and size of the discriminant for an enum.
/// Private. Used by derive.
pub fn discriminant<T, F: Fn(&T) -> bool>(v: T, matches: F) -> (usize, usize) {
  let mut value = v;
  let slice = unsafe {
    std::slice::from_raw_parts_mut(&mut value as *mut _ as *mut u8, std::mem::size_of::<T>())
  };

  let mut offset = 0;
  let mut size = 0;
  for (i, b) in slice.iter_mut().enumerate() {
    let v = *b;
    *b = 123;
    if !matches(&value) {
      if size == 0 {
        offset = i;
      }
      size += 1;
    }
    *b = v;
  }

  (offset, size)
}

/// Returns an enum discriminant as a number.
/// Private. Used by derive.
pub fn discriminant_value<T>(v: T, offset: usize, size: usize) -> usize {
  unsafe {
    let ptr = (&v as *const _ as *const u8).add(offset);
    match size {
      1 => *ptr as usize,
      2 => *(ptr as *const u16) as usize,
      4 => *(ptr as *const u32) as usize,
      _ => unreachable!(),
    }
  }
}

fn option_discriminant<T>(db: &str, addr: &str, offset: usize, operator: &str) -> Vec<String> {
  // This infers the byte pattern for None of a given type. Due to discriminant elision,
  // there may be no separate byte for the discriminant. Instead, the Rust compiler uses
  // "niche" values of the contained type that would otherwise be invalid.
  // https://github.com/rust-lang/unsafe-code-guidelines/blob/master/reference/src/layout/enums.md#discriminant-elision-on-option-like-enums
  // To find the byte pattern, we create a None value, and then try flipping all of the bytes
  // in the value to see if they have an effect on the Option discriminant.
  let mut none: Option<T> = None;
  let slice = unsafe {
    std::slice::from_raw_parts_mut(
      &mut none as *mut _ as *mut u8,
      std::mem::size_of::<Option<T>>(),
    )
  };
  let mut comparisons = Vec::new();
  let mut zeros = 0;
  let mut zero_offset = 0;
  for (i, b) in slice.iter_mut().enumerate() {
    let v = *b;
    *b = 123;
    if !none.is_none() {
      comparisons.push(if operator == "===" {
        format!(
          "readU8({}, {} + {} + {:?}) {} {:?}",
          db, addr, offset, i, operator, v
        )
      } else {
        format!("writeU8({}, {} + {} + {:?}, {:?})", db, addr, offset, i, v)
      });
      if v == 0 {
        if zeros == 0 {
          zero_offset = i;
        }
        zeros += 1;
      } else {
        zeros = 0;
      }
    }
    *b = v;
  }

  // Optimize subsequent zeros into a single 32 bit access instead of 4 individual byte accesses.
  if zeros == comparisons.len() {
    if zeros == 4 || zeros == 8 {
      comparisons.clear();
      comparisons.push(if operator == "===" {
        format!(
          "readU32({}, {} + {} + {}) {} 0",
          db, addr, offset, zero_offset, operator
        )
      } else {
        format!(
          "writeU32({}, {} + {} + {}, 0)",
          db, addr, offset, zero_offset
        )
      });
      if zeros == 8 {
        comparisons.push(if operator == "===" {
          format!(
            "readU32({}, {} + {} + {:?}) {} 0",
            db,
            addr,
            offset,
            zero_offset + 4,
            operator
          )
        } else {
          format!(
            "writeU32({}, {} + {} + {}, 0)",
            db,
            addr,
            offset,
            zero_offset + 4
          )
        })
      }
    }
  }

  comparisons
}

impl<T: JsValue> JsValue for Option<T> {
  fn js_getter(db: &str, addr: &str, offset: usize) -> String {
    let value_offset = option_offset::<T>();
    if value_offset == 0 {
      let discriminant = option_discriminant::<T>(db, addr, offset, "===").join(" && ");
      format!(
        "{} ? null : {}",
        discriminant,
        T::js_getter(db, addr, offset)
      )
    } else {
      format!(
        "{} === 0 ? null : {}",
        match value_offset {
          1 => u8::js_getter(db, addr, offset),
          4 => u32::js_getter(db, addr, offset),
          _ => todo!(),
        },
        T::js_getter(db, addr, offset + value_offset)
      )
    }
  }

  fn js_setter(db: &str, addr: &str, offset: usize, value: &str) -> String {
    // TODO: run Rust destructors when setting to null...
    let value_offset = option_offset::<T>();
    if value_offset == 0 {
      return format!(
        r#"if (value == null) {{
      {set_none};
    }} else {{
      {setter};
    }}"#,
        set_none = option_discriminant::<T>(db, addr, offset, "=").join(";\n      "),
        setter = T::js_setter(db, addr, offset, value),
      );
    }

    format!(
      r#"{};
    if (value != null) {}"#,
      match value_offset {
        1 => u8::js_setter(db, addr, offset, "value == null ? 0 : 1"),
        4 => u32::js_setter(db, addr, offset, "value == null ? 0 : 1"),
        _ => todo!(),
      },
      T::js_setter(db, addr, offset + value_offset, value)
    )
  }

  fn ty() -> String {
    format!("?{}", <T>::ty())
  }
}

/// A macro to generate a bitflags type that can be accessed from JS.
macro_rules! js_bitflags {
  (
    $(#[$outer:meta])*
    $vis:vis struct $BitFlags:ident: $T:ty {
      $(
        $(#[$inner:ident $($args:tt)*])*
        const $Flag:ident $(($vp:ident))? = $value:expr;
      )*
    }
  ) => {
    bitflags::bitflags! {
      $(#[$outer])*
      #[derive(Debug, PartialEq, Eq, Hash, Clone, Copy, Default)]
      $vis struct $BitFlags: $T {
        $(
          $(#[$inner $($args)*])*
            const $Flag = $value;
        )*
      }
    }

    impl JsValue for $BitFlags {
      fn js_getter(db: &str, addr: &str, offset: usize) -> String {
        <$T>::js_getter(db, addr, offset)
      }

      fn js_setter(db: &str, addr: &str, offset: usize, value: &str) -> String {
        <$T>::js_setter(db, addr, offset, value)
      }

      fn ty() -> String {
        <$T>::ty()
      }
    }

    impl ToJs for $BitFlags {
      fn to_js() -> String {
        let mut js = String::new();
        js.push_str(&format!("export const {} = {{\n", stringify!($BitFlags)));
        $(
          js.push_str(&format!("  {}: 0b{:b},\n", stringify!($Flag), $BitFlags::$Flag));
        )*
        js.push_str("};\n");
        js
      }
    }

    paste::paste! {
      #[ctor::ctor]
      #[allow(non_snake_case)]
      unsafe fn [<register_ $BitFlags>]() {
        use std::io::Write;
        use crate::codegen::WRITE_CALLBACKS;
        WRITE_CALLBACKS.push(|file| write!(file, "{}", $BitFlags::to_js()))
      }
    }
  }
}

pub(crate) use js_bitflags;
