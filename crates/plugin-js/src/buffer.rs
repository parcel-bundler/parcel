use data_encoding::{BASE64, BASE64URL};
use rquickjs::{Ctx, Function, Object, TypedArray};

fn bytes<'a, 'js>(ctx: &Ctx<'js>, value: &'a TypedArray<'js, u8>) -> rquickjs::Result<&'a [u8]> {
  // The slice is owned by QuickJS and remains valid for the lifetime of this call/context.
  value
    .as_bytes()
    .ok_or_else(|| rquickjs::Exception::throw_type(ctx, "Expected an attached Uint8Array"))
}

fn base64_byte_length(input: String) -> usize {
  let valid_len = input.find('=').unwrap_or(input.len());
  let placeholders = if valid_len == input.len() {
    0
  } else {
    4 - (valid_len % 4)
  };
  ((valid_len + placeholders) * 3 / 4).saturating_sub(placeholders)
}

fn base64_to_byte_array<'js>(
  ctx: Ctx<'js>,
  input: String,
) -> rquickjs::Result<TypedArray<'js, u8>> {
  let encoding = if input.bytes().any(|byte| matches!(byte, b'-' | b'_')) {
    BASE64URL
  } else {
    BASE64
  };
  let decoded = encoding
    .decode(input.as_bytes())
    .map_err(|_| rquickjs::Exception::throw_message(&ctx, "Invalid base64 string"))?;
  TypedArray::new(ctx, decoded)
}

fn base64_from_byte_array<'js>(
  ctx: Ctx<'js>,
  input: TypedArray<'js, u8>,
) -> rquickjs::Result<String> {
  Ok(BASE64.encode(bytes(&ctx, &input)?))
}

fn hex_encode<'js>(
  ctx: Ctx<'js>,
  input: TypedArray<'js, u8>,
  start: rquickjs::function::Opt<usize>,
  end: rquickjs::function::Opt<usize>,
) -> rquickjs::Result<String> {
  let input = bytes(&ctx, &input)?;
  let start = start.0.unwrap_or(0).min(input.len());
  let end = end.0.unwrap_or(input.len()).min(input.len()).max(start);
  let mut output = String::with_capacity((end - start) * 2);
  const HEX: &[u8; 16] = b"0123456789abcdef";
  for &byte in &input[start..end] {
    output.push(HEX[(byte >> 4) as usize] as char);
    output.push(HEX[(byte & 0x0f) as usize] as char);
  }
  Ok(output)
}

fn hex_value(byte: u8) -> Option<u8> {
  match byte {
    b'0'..=b'9' => Some(byte - b'0'),
    b'a'..=b'f' => Some(byte - b'a' + 10),
    b'A'..=b'F' => Some(byte - b'A' + 10),
    _ => None,
  }
}

fn hex_decode<'js>(ctx: Ctx<'js>, input: String) -> rquickjs::Result<TypedArray<'js, u8>> {
  // Node stops at an invalid or incomplete pair rather than rejecting the whole string.
  let input = input.as_bytes();
  let mut output = Vec::with_capacity(input.len() / 2);
  for pair in input.chunks_exact(2) {
    let (Some(high), Some(low)) = (hex_value(pair[0]), hex_value(pair[1])) else {
      break;
    };
    output.push((high << 4) | low);
  }
  TypedArray::new(ctx, output)
}

fn compare<'js>(
  ctx: Ctx<'js>,
  left: TypedArray<'js, u8>,
  right: TypedArray<'js, u8>,
) -> rquickjs::Result<i32> {
  use std::cmp::Ordering;
  Ok(match bytes(&ctx, &left)?.cmp(bytes(&ctx, &right)?) {
    Ordering::Less => -1,
    Ordering::Equal => 0,
    Ordering::Greater => 1,
  })
}

/// Native implementation of the tiny `base64-js` package used by `buffer`.
/// Keeping the same exports lets the existing Buffer facade use native codecs
/// without changing its public constructor/prototype semantics.
pub fn base64_module<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Object<'js>> {
  let module = Object::new(ctx.clone())?;
  module.set(
    "byteLength",
    Function::new(ctx.clone(), base64_byte_length)?,
  )?;
  module.set(
    "toByteArray",
    Function::new(ctx.clone(), base64_to_byte_array)?,
  )?;
  module.set(
    "fromByteArray",
    Function::new(ctx.clone(), base64_from_byte_array)?,
  )?;
  Ok(module)
}

/// Additional bulk primitives used by the Buffer JS facade. Small scalar
/// operations intentionally stay in JS, where crossing the native boundary
/// would cost more than it saves.
pub fn native_module<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Object<'js>> {
  let module = Object::new(ctx.clone())?;
  module.set("hexEncode", Function::new(ctx.clone(), hex_encode)?)?;
  module.set("hexDecode", Function::new(ctx.clone(), hex_decode)?)?;
  module.set("compare", Function::new(ctx.clone(), compare)?)?;
  Ok(module)
}
