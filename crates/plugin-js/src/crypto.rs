use std::slice;

use data_encoding::{BASE64, BASE64URL_NOPAD};
use rquickjs::{
  ArrayBuffer, Class, Ctx, FromJs, Function, IntoJs, JsLifetime, Object, Value,
  class::{JsClass, Trace},
  function::{Opt, Rest},
  module::ModuleDef,
};
use sha2::digest::Digest;

/// The intentionally small Node `crypto` surface supported by the plugin runtime.
/// Public-key crypto, ciphers, signatures, Diffie-Hellman, pbkdf2, etc. are not supported.
#[derive(Clone, Copy)]
enum Algorithm {
  Md5,
  Sha1,
  Sha224,
  Sha256,
  Sha384,
  Sha512,
}

impl Algorithm {
  fn parse<'js>(ctx: &Ctx<'js>, value: &str) -> rquickjs::Result<Self> {
    let normalized = value.to_ascii_lowercase().replace(['-', '_'], "");
    match normalized.as_str() {
      "md5" => Ok(Self::Md5),
      "sha1" => Ok(Self::Sha1),
      "sha224" => Ok(Self::Sha224),
      "sha256" => Ok(Self::Sha256),
      "sha384" => Ok(Self::Sha384),
      "sha512" => Ok(Self::Sha512),
      _ => Err(rquickjs::Exception::throw_message(
        ctx,
        &format!("Digest method not supported: {value}"),
      )),
    }
  }

  fn block_len(self) -> usize {
    match self {
      Self::Sha384 | Self::Sha512 => 128,
      _ => 64,
    }
  }
}

#[derive(Clone)]
enum HashState {
  Md5(md5::Md5),
  Sha1(sha1::Sha1),
  Sha224(sha2::Sha224),
  Sha256(sha2::Sha256),
  Sha384(sha2::Sha384),
  Sha512(sha2::Sha512),
}

impl HashState {
  fn new(algorithm: Algorithm) -> Self {
    match algorithm {
      Algorithm::Md5 => Self::Md5(md5::Md5::new()),
      Algorithm::Sha1 => Self::Sha1(sha1::Sha1::new()),
      Algorithm::Sha224 => Self::Sha224(sha2::Sha224::new()),
      Algorithm::Sha256 => Self::Sha256(sha2::Sha256::new()),
      Algorithm::Sha384 => Self::Sha384(sha2::Sha384::new()),
      Algorithm::Sha512 => Self::Sha512(sha2::Sha512::new()),
    }
  }

  fn update(&mut self, data: &[u8]) {
    match self {
      Self::Md5(state) => state.update(data),
      Self::Sha1(state) => state.update(data),
      Self::Sha224(state) => state.update(data),
      Self::Sha256(state) => state.update(data),
      Self::Sha384(state) => state.update(data),
      Self::Sha512(state) => state.update(data),
    }
  }

  fn finalize(self) -> Vec<u8> {
    match self {
      Self::Md5(state) => state.finalize().to_vec(),
      Self::Sha1(state) => state.finalize().to_vec(),
      Self::Sha224(state) => state.finalize().to_vec(),
      Self::Sha256(state) => state.finalize().to_vec(),
      Self::Sha384(state) => state.finalize().to_vec(),
      Self::Sha512(state) => state.finalize().to_vec(),
    }
  }
}

#[derive(Trace)]
#[rquickjs::class]
pub struct Hash {
  #[qjs(skip_trace)]
  state: Option<HashState>,
}

unsafe impl<'js> JsLifetime<'js> for Hash {
  type Changed<'to> = Hash;
}

#[rquickjs::methods]
impl Hash {
  #[qjs(constructor)]
  pub fn new<'js>(ctx: Ctx<'js>, algorithm: String) -> rquickjs::Result<Self> {
    Ok(Self {
      state: Some(HashState::new(Algorithm::parse(&ctx, &algorithm)?)),
    })
  }

  /// Native half of `update`. `crypto_module` installs the public wrapper that returns `this`.
  pub fn _update<'js>(
    &mut self,
    ctx: Ctx<'js>,
    data: Value<'js>,
    encoding: Opt<String>,
  ) -> rquickjs::Result<()> {
    let state = self
      .state
      .as_mut()
      .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "Digest already called"))?;
    with_value_bytes(&ctx, &data, encoding.0.as_deref(), |bytes| {
      state.update(bytes)
    })
  }

  pub fn digest<'js>(
    &mut self,
    ctx: Ctx<'js>,
    encoding: Opt<String>,
  ) -> rquickjs::Result<Value<'js>> {
    let state = self
      .state
      .take()
      .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "Digest already called"))?;
    encode_output(ctx, state.finalize(), encoding.0.as_deref())
  }
}

#[derive(Clone)]
struct HmacState {
  inner: HashState,
  outer: HashState,
}

impl HmacState {
  fn new(algorithm: Algorithm, mut key: Vec<u8>) -> Self {
    let block_len = algorithm.block_len();
    if key.len() > block_len {
      let mut hash = HashState::new(algorithm);
      hash.update(&key);
      key = hash.finalize();
    }
    key.resize(block_len, 0);

    let mut inner_pad = key.clone();
    let mut outer_pad = key;
    for byte in &mut inner_pad {
      *byte ^= 0x36;
    }
    for byte in &mut outer_pad {
      *byte ^= 0x5c;
    }

    let mut inner = HashState::new(algorithm);
    inner.update(&inner_pad);
    let mut outer = HashState::new(algorithm);
    outer.update(&outer_pad);
    Self { inner, outer }
  }

  fn update(&mut self, data: &[u8]) {
    self.inner.update(data);
  }

  fn finalize(self) -> Vec<u8> {
    let inner_digest = self.inner.finalize();
    let mut outer = self.outer;
    outer.update(&inner_digest);
    outer.finalize()
  }
}

#[derive(Trace)]
#[rquickjs::class]
pub struct Hmac {
  #[qjs(skip_trace)]
  state: Option<HmacState>,
}

unsafe impl<'js> JsLifetime<'js> for Hmac {
  type Changed<'to> = Hmac;
}

#[rquickjs::methods]
impl Hmac {
  #[qjs(constructor)]
  pub fn new<'js>(
    ctx: Ctx<'js>,
    algorithm: String,
    key: Value<'js>,
    options: Opt<Object<'js>>,
  ) -> rquickjs::Result<Self> {
    let algorithm = Algorithm::parse(&ctx, &algorithm)?;
    let encoding = options
      .0
      .as_ref()
      .and_then(|options| options.get::<_, String>("encoding").ok());
    let key = value_to_bytes(&ctx, &key, encoding.as_deref())?;
    Ok(Self {
      state: Some(HmacState::new(algorithm, key)),
    })
  }

  /// Native half of `update`. `crypto_module` installs the public wrapper that returns `this`.
  pub fn _update<'js>(
    &mut self,
    ctx: Ctx<'js>,
    data: Value<'js>,
    encoding: Opt<String>,
  ) -> rquickjs::Result<()> {
    let state = self
      .state
      .as_mut()
      .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "Digest already called"))?;
    with_value_bytes(&ctx, &data, encoding.0.as_deref(), |bytes| {
      state.update(bytes)
    })
  }

  pub fn digest<'js>(
    &mut self,
    ctx: Ctx<'js>,
    encoding: Opt<String>,
  ) -> rquickjs::Result<Value<'js>> {
    let state = self
      .state
      .take()
      .ok_or_else(|| rquickjs::Exception::throw_message(&ctx, "Digest already called"))?;
    encode_output(ctx, state.finalize(), encoding.0.as_deref())
  }
}

fn create_hash<'js>(
  ctx: Ctx<'js>,
  algorithm: String,
  _options: Opt<Value<'js>>,
) -> rquickjs::Result<Class<'js, Hash>> {
  Class::instance(ctx.clone(), Hash::new(ctx, algorithm)?)
}

fn create_hmac<'js>(
  ctx: Ctx<'js>,
  algorithm: String,
  key: Value<'js>,
  options: Opt<Object<'js>>,
) -> rquickjs::Result<Class<'js, Hmac>> {
  let hmac = Hmac::new(ctx.clone(), algorithm, key, options)?;
  Class::instance(ctx, hmac)
}

fn safe_integer<'js>(ctx: &Ctx<'js>, value: Value<'js>, name: &str) -> rquickjs::Result<i64> {
  const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
  let number = f64::from_js(ctx, value)
    .map_err(|_| rquickjs::Exception::throw_type(ctx, &format!("{name} must be a safe integer")))?;
  if !number.is_finite() || number.fract() != 0.0 || number.abs() > MAX_SAFE_INTEGER as f64 {
    return Err(rquickjs::Exception::throw_type(
      ctx,
      &format!("{name} must be a safe integer"),
    ));
  }
  Ok(number as i64)
}

fn optional_callback<'js>(
  ctx: &Ctx<'js>,
  value: Option<Value<'js>>,
) -> rquickjs::Result<Option<Function<'js>>> {
  match value {
    None => Ok(None),
    Some(value) if value.is_undefined() => Ok(None),
    Some(value) => value
      .as_function()
      .cloned()
      .map(Some)
      .ok_or_else(|| rquickjs::Exception::throw_type(ctx, "callback must be a function")),
  }
}

fn random_bytes<'js>(
  ctx: Ctx<'js>,
  size: Value<'js>,
  callback: Opt<Value<'js>>,
) -> rquickjs::Result<Value<'js>> {
  let size = safe_integer(&ctx, size, "size")?;
  if !(0..=i32::MAX as i64).contains(&size) {
    return Err(rquickjs::Exception::throw_range(
      &ctx,
      "size must be a non-negative integer",
    ));
  }
  let callback = optional_callback(&ctx, callback.0)?;
  let mut bytes = vec![0; size as usize];
  getrandom::fill(&mut bytes)
    .map_err(|error| rquickjs::Exception::throw_message(&ctx, &error.to_string()))?;
  let buffer = buffer_from_bytes(ctx.clone(), bytes)?;
  if let Some(callback) = callback {
    callback.call::<_, ()>((rquickjs::Null, buffer))?;
    rquickjs::Undefined.into_js(&ctx)
  } else {
    Ok(buffer)
  }
}

fn random_int<'js>(ctx: Ctx<'js>, args: Rest<Value<'js>>) -> rquickjs::Result<Value<'js>> {
  let args = args.0;
  let (min_value, max_value, callback) = match args.as_slice() {
    [] => {
      return Err(rquickjs::Exception::throw_type(
        &ctx,
        "max must be a safe integer",
      ));
    }
    [max] => (None, max.clone(), None),
    [max, callback] if callback.is_undefined() || callback.is_function() => (
      None,
      max.clone(),
      optional_callback(&ctx, Some(callback.clone()))?,
    ),
    [min, max] => (Some(min.clone()), max.clone(), None),
    [min, max, callback] => (
      Some(min.clone()),
      max.clone(),
      optional_callback(&ctx, Some(callback.clone()))?,
    ),
    _ => {
      return Err(rquickjs::Exception::throw_type(
        &ctx,
        "callback must be a function",
      ));
    }
  };

  let min = min_value
    .map(|value| safe_integer(&ctx, value, "min"))
    .transpose()?
    .unwrap_or(0);
  let max = safe_integer(&ctx, max_value, "max")?;
  let range = max - min;
  const RANDOM_SPACE: u64 = 1 << 48;
  if range <= 0 {
    return Err(rquickjs::Exception::throw_range(
      &ctx,
      "max must be greater than min",
    ));
  }
  if range as u64 >= RANDOM_SPACE {
    return Err(rquickjs::Exception::throw_range(
      &ctx,
      "max - min must be less than 2^48",
    ));
  }

  // Rejection sampling avoids the modulo bias that would otherwise occur unless the requested
  // range evenly divided the 48-bit random space used by Node's API.
  let range = range as u64;
  let limit = RANDOM_SPACE - (RANDOM_SPACE % range);
  let random = loop {
    let mut bytes = [0u8; 6];
    getrandom::fill(&mut bytes)
      .map_err(|error| rquickjs::Exception::throw_message(&ctx, &error.to_string()))?;
    let value = bytes
      .into_iter()
      .fold(0u64, |value, byte| (value << 8) | byte as u64);
    if value < limit {
      break value % range;
    }
  };
  let result = min + random as i64;

  if let Some(callback) = callback {
    callback.call::<_, ()>((rquickjs::Undefined, result as f64))?;
    rquickjs::Undefined.into_js(&ctx)
  } else {
    (result as f64).into_js(&ctx)
  }
}

fn byte_view<'js>(
  ctx: &Ctx<'js>,
  object: &Object<'js>,
) -> rquickjs::Result<(ArrayBuffer<'js>, usize, usize)> {
  if let Some(buffer) = ArrayBuffer::from_object(object.clone()) {
    let len = buffer.len();
    return Ok((buffer, 0, len));
  }

  let buffer: ArrayBuffer = object.get("buffer").map_err(|_| {
    rquickjs::Exception::throw_type(ctx, "buffer must be an ArrayBuffer or ArrayBuffer view")
  })?;
  let offset = object.get::<_, usize>("byteOffset").unwrap_or(0);
  let length = object.get::<_, usize>("byteLength").map_err(|_| {
    rquickjs::Exception::throw_type(ctx, "buffer must be an ArrayBuffer or ArrayBuffer view")
  })?;
  if offset
    .checked_add(length)
    .is_none_or(|end| end > buffer.len())
  {
    return Err(rquickjs::Exception::throw_range(ctx, "Invalid buffer view"));
  }
  Ok((buffer, offset, length))
}

fn fill_object<'js>(
  ctx: &Ctx<'js>,
  object: &Object<'js>,
  offset: i64,
  size: Option<i64>,
) -> rquickjs::Result<()> {
  let (buffer, view_offset, view_len) = byte_view(ctx, object)?;
  if offset < 0 || offset as usize > view_len {
    return Err(rquickjs::Exception::throw_range(
      ctx,
      "offset is out of range",
    ));
  }
  let offset = offset as usize;
  let size = size.unwrap_or((view_len - offset) as i64);
  if size < 0 || (size as usize) > view_len - offset {
    return Err(rquickjs::Exception::throw_range(
      ctx,
      "size is out of range",
    ));
  }

  let raw = buffer
    .as_raw()
    .ok_or_else(|| rquickjs::Exception::throw_type(ctx, "ArrayBuffer is detached"))?;
  // SAFETY: QuickJS owns this non-detached ArrayBuffer on the current single JS thread. The range
  // is checked against both the view and its underlying allocation above.
  let bytes =
    unsafe { slice::from_raw_parts_mut(raw.ptr.as_ptr().add(view_offset + offset), size as usize) };
  getrandom::fill(bytes)
    .map_err(|error| rquickjs::Exception::throw_message(ctx, &error.to_string()))
}

fn random_fill_sync<'js>(
  ctx: Ctx<'js>,
  buffer: Object<'js>,
  offset: Opt<i64>,
  size: Opt<i64>,
) -> rquickjs::Result<Object<'js>> {
  fill_object(&ctx, &buffer, offset.0.unwrap_or(0), size.0)?;
  Ok(buffer)
}

fn random_fill<'js>(
  ctx: Ctx<'js>,
  buffer: Object<'js>,
  args: Rest<Value<'js>>,
) -> rquickjs::Result<()> {
  let Some(callback) = args.0.last().and_then(Value::as_function) else {
    return Err(rquickjs::Exception::throw_type(
      &ctx,
      "callback must be a function",
    ));
  };
  let offset = args
    .0
    .first()
    .filter(|value| !value.is_function())
    .map(|value| i64::from_js(&ctx, value.clone()))
    .transpose()?
    .unwrap_or(0);
  let size = args
    .0
    .get(1)
    .filter(|value| !value.is_function())
    .map(|value| i64::from_js(&ctx, value.clone()))
    .transpose()?;
  fill_object(&ctx, &buffer, offset, size)?;
  callback.call((rquickjs::Null, buffer))
}

fn get_random_values<'js>(ctx: Ctx<'js>, array: Object<'js>) -> rquickjs::Result<Object<'js>> {
  // Web Crypto accepts integer TypedArrays, including Uint8ClampedArray and the BigInt variants,
  // but rejects DataView, ArrayBuffer, and floating-point TypedArrays. QuickJS's enum assigns the
  // accepted variants the contiguous values 0 through 8.
  let array_type = unsafe { rquickjs_sys::JS_GetTypedArrayType(array.as_raw()) };
  if !(0..=8).contains(&array_type) {
    return Err(rquickjs::Exception::throw_type(
      &ctx,
      "Expected an integer TypedArray",
    ));
  }

  let (_, _, byte_length) = byte_view(&ctx, &array)?;
  if byte_length > 65_536 {
    let error =
      rquickjs::Exception::from_message(ctx.clone(), "The requested length exceeds 65,536 bytes")?;
    error.set("name", "QuotaExceededError")?;
    return Err(error.throw());
  }

  fill_object(&ctx, &array, 0, None)?;
  Ok(array)
}

fn random_uuid<'js>(ctx: Ctx<'js>) -> rquickjs::Result<String> {
  let mut bytes = [0u8; 16];
  getrandom::fill(&mut bytes)
    .map_err(|error| rquickjs::Exception::throw_message(&ctx, &error.to_string()))?;

  // RFC 4122 version 4 with the RFC 9562 variant bits used by Web Crypto.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const HEX: &[u8; 16] = b"0123456789abcdef";
  let mut hex = String::with_capacity(32);
  for byte in bytes {
    hex.push(HEX[(byte >> 4) as usize] as char);
    hex.push(HEX[(byte & 0x0f) as usize] as char);
  }
  Ok(format!(
    "{}-{}-{}-{}-{}",
    &hex[0..8],
    &hex[8..12],
    &hex[12..16],
    &hex[16..20],
    &hex[20..32]
  ))
}

fn get_hashes() -> Vec<&'static str> {
  vec!["md5", "sha1", "sha224", "sha256", "sha384", "sha512"]
}

/// Construct the intentionally small Web Crypto surface shared by the global and Node module.
pub fn webcrypto_module<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Object<'js>> {
  let module = Object::new(ctx.clone())?;
  module.set(
    "getRandomValues",
    Function::new(ctx.clone(), get_random_values)?,
  )?;
  module.set("randomUUID", Function::new(ctx.clone(), random_uuid)?)?;
  Ok(module)
}

fn value_to_bytes<'js>(
  ctx: &Ctx<'js>,
  value: &Value<'js>,
  encoding: Option<&str>,
) -> rquickjs::Result<Vec<u8>> {
  with_value_bytes(ctx, value, encoding, <[u8]>::to_vec)
}

fn with_value_bytes<'js, T>(
  ctx: &Ctx<'js>,
  value: &Value<'js>,
  encoding: Option<&str>,
  callback: impl FnOnce(&[u8]) -> T,
) -> rquickjs::Result<T> {
  if let Some(string) = value.as_string() {
    let string = string.to_string()?;
    let bytes = decode_string(ctx, &string, encoding.unwrap_or("utf8"))?;
    return Ok(callback(&bytes));
  }

  let Some(object) = value.as_object() else {
    return Err(rquickjs::Exception::throw_type(
      ctx,
      "data must be a string, Buffer, TypedArray, DataView, or ArrayBuffer",
    ));
  };
  let (buffer, offset, len) = byte_view(ctx, object)?;
  let bytes = buffer
    .as_bytes()
    .ok_or_else(|| rquickjs::Exception::throw_type(ctx, "ArrayBuffer is detached"))?;
  Ok(callback(&bytes[offset..offset + len]))
}

fn decode_string<'js>(ctx: &Ctx<'js>, value: &str, encoding: &str) -> rquickjs::Result<Vec<u8>> {
  match encoding.to_ascii_lowercase().as_str() {
    "utf8" | "utf-8" => Ok(value.as_bytes().to_vec()),
    "latin1" | "binary" | "ascii" => Ok(
      value
        .chars()
        .map(|character| character as u32 as u8)
        .collect(),
    ),
    "utf16le" | "utf-16le" | "ucs2" | "ucs-2" => {
      Ok(value.encode_utf16().flat_map(u16::to_le_bytes).collect())
    }
    "hex" => decode_hex(ctx, value),
    "base64" | "base64url" => decode_base64(ctx, value),
    other => Err(rquickjs::Exception::throw_type(
      ctx,
      &format!("Unknown encoding: {other}"),
    )),
  }
}

fn decode_hex<'js>(ctx: &Ctx<'js>, value: &str) -> rquickjs::Result<Vec<u8>> {
  if value.len() % 2 != 0 {
    return Err(rquickjs::Exception::throw_type(ctx, "Invalid hex string"));
  }
  let mut output = Vec::with_capacity(value.len() / 2);
  for pair in value.as_bytes().chunks_exact(2) {
    let (Some(high), Some(low)) = (
      (pair[0] as char).to_digit(16),
      (pair[1] as char).to_digit(16),
    ) else {
      // Node decodes the valid prefix of an even-length hex string.
      break;
    };
    output.push(((high << 4) | low) as u8);
  }
  Ok(output)
}

fn decode_base64<'js>(ctx: &Ctx<'js>, value: &str) -> rquickjs::Result<Vec<u8>> {
  // Buffer's base64 decoder accepts whitespace, omitted padding, and the URL-safe alphabet for
  // both the `base64` and `base64url` labels.
  let mut normalized: String = value
    .chars()
    .filter(|character| !character.is_ascii_whitespace())
    .map(|character| match character {
      '-' => '+',
      '_' => '/',
      character => character,
    })
    .collect();
  normalized.truncate(normalized.trim_end_matches('=').len());
  while normalized.len() % 4 != 0 {
    normalized.push('=');
  }
  BASE64
    .decode(normalized.as_bytes())
    .map_err(|_| rquickjs::Exception::throw_type(ctx, "Invalid base64 string"))
}

fn encode_output<'js>(
  ctx: Ctx<'js>,
  bytes: Vec<u8>,
  encoding: Option<&str>,
) -> rquickjs::Result<Value<'js>> {
  let Some(encoding) = encoding else {
    return buffer_from_bytes(ctx, bytes);
  };
  let output = match encoding.to_ascii_lowercase().as_str() {
    "hex" => {
      const HEX: &[u8; 16] = b"0123456789abcdef";
      let mut output = String::with_capacity(bytes.len() * 2);
      for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0xf) as usize] as char);
      }
      output
    }
    "base64" => BASE64.encode(&bytes),
    "base64url" => BASE64URL_NOPAD.encode(&bytes),
    "latin1" | "binary" => bytes.into_iter().map(char::from).collect(),
    other => {
      return Err(rquickjs::Exception::throw_type(
        &ctx,
        &format!("Unknown encoding: {other}"),
      ));
    }
  };
  rquickjs::String::from_str(ctx, &output).map(rquickjs::String::into_value)
}

fn buffer_from_bytes<'js>(ctx: Ctx<'js>, bytes: Vec<u8>) -> rquickjs::Result<Value<'js>> {
  let buffer_constructor: Object = ctx.globals().get("Buffer")?;
  let from: Function = buffer_constructor.get("from")?;
  let array_buffer = ArrayBuffer::new(ctx, bytes)?;
  from.call((array_buffer,))
}

/// Construct the CommonJS-facing module object. This is also the source of ESM named exports.
pub fn crypto_module<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Object<'js>> {
  let module = Object::new(ctx.clone())?;

  // Rust class receivers cannot directly return their original JS object. Keep the byte processing
  // native and use this small adapter to preserve Node's chain and identity behavior.
  let update: Function = ctx.eval(
    "(function update(data, encoding) { if (arguments.length < 2) this._update(data); else this._update(data, encoding); return this; })",
  )?;
  Class::<Hash>::prototype(ctx)?
    .unwrap()
    .set("update", update.clone())?;
  Class::<Hmac>::prototype(ctx)?
    .unwrap()
    .set("update", update)?;

  let hash_constructor = Hash::constructor(ctx)?.unwrap();
  let hmac_constructor = Hmac::constructor(ctx)?.unwrap();
  module.set("Hash", hash_constructor)?;
  module.set("Hmac", hmac_constructor)?;
  module.set("createHash", Function::new(ctx.clone(), create_hash)?)?;
  module.set("createHmac", Function::new(ctx.clone(), create_hmac)?)?;
  let random_bytes = Function::new(ctx.clone(), random_bytes)?;
  module.set("randomBytes", random_bytes.clone())?;
  module.set("pseudoRandomBytes", random_bytes)?;
  module.set("randomInt", Function::new(ctx.clone(), random_int)?)?;
  module.set("randomFill", Function::new(ctx.clone(), random_fill)?)?;
  module.set(
    "randomFillSync",
    Function::new(ctx.clone(), random_fill_sync)?,
  )?;
  module.set("getHashes", Function::new(ctx.clone(), get_hashes)?)?;
  module.set("webcrypto", ctx.globals().get::<_, Object>("crypto")?)?;
  Ok(module)
}

pub struct Crypto;

impl ModuleDef for Crypto {
  fn declare<'js>(declarations: &rquickjs::module::Declarations<'js>) -> rquickjs::Result<()> {
    for name in [
      "default",
      "Hash",
      "Hmac",
      "createHash",
      "createHmac",
      "randomBytes",
      "randomInt",
      "pseudoRandomBytes",
      "randomFill",
      "randomFillSync",
      "getHashes",
      "webcrypto",
    ] {
      declarations.declare(name)?;
    }
    Ok(())
  }

  fn evaluate<'js>(
    ctx: &Ctx<'js>,
    exports: &rquickjs::module::Exports<'js>,
  ) -> rquickjs::Result<()> {
    let module = crypto_module(ctx)?;
    exports.export("default", module.clone())?;
    for name in [
      "Hash",
      "Hmac",
      "createHash",
      "createHmac",
      "randomBytes",
      "randomInt",
      "pseudoRandomBytes",
      "randomFill",
      "randomFillSync",
      "getHashes",
      "webcrypto",
    ] {
      exports.export(name, module.get::<_, Value>(name)?)?;
    }
    Ok(())
  }
}
