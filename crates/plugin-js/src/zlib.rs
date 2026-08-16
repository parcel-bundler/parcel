//! Native, one-shot implementations of the byte-oriented parts of Node's
//! `zlib` module.
//!
//! The public Node API (callbacks and `Transform` streams) intentionally lives
//! in `builtin-src/native-zlib/index.js`. Keeping the boundary byte-in/byte-out
//! avoids driving a Rust codec through QuickJS once per output chunk.

use std::io::{self, Cursor, Read, Write};

use flate2::{
  Compression,
  read::{DeflateDecoder, MultiGzDecoder, ZlibDecoder},
  write::{DeflateEncoder, GzEncoder, ZlibEncoder},
};
use rquickjs::{Ctx, FromJs, Function, Object, TypedArray, Value, function::Opt};

const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

#[derive(Debug)]
struct CodecOptions {
  level: Compression,
  max_output_length: usize,
}

impl Default for CodecOptions {
  fn default() -> Self {
    Self {
      level: Compression::default(),
      max_output_length: usize::MAX,
    }
  }
}

impl CodecOptions {
  fn from_js<'js>(ctx: &Ctx<'js>, options: Opt<Object<'js>>) -> rquickjs::Result<Self> {
    let Some(options) = options.0 else {
      return Ok(Self::default());
    };

    let mut result = Self::default();
    if let Some(level) = option::<i32>(&options, "level")? {
      if !(-1..=9).contains(&level) {
        return Err(rquickjs::Exception::throw_range(
          ctx,
          "The value of options.level is out of range. It must be >= -1 and <= 9.",
        ));
      }
      if level >= 0 {
        result.level = Compression::new(level as u32);
      }
    }

    // rust_backend uses miniz_oxide's 32 KiB window. Accepting the other Node
    // values would silently produce a stream with different memory semantics.
    if let Some(window_bits) = option::<i32>(&options, "windowBits")? {
      if !(8..=15).contains(&window_bits) {
        return Err(rquickjs::Exception::throw_range(
          ctx,
          "The value of options.windowBits is out of range. It must be >= 8 and <= 15.",
        ));
      }
      if window_bits != 15 {
        return Err(rquickjs::Exception::throw_message(
          ctx,
          "zlib windowBits values below 15 are not supported by the Rust backend",
        ));
      }
    }

    if let Some(mem_level) = option::<i32>(&options, "memLevel")? {
      if !(1..=9).contains(&mem_level) {
        return Err(rquickjs::Exception::throw_range(
          ctx,
          "The value of options.memLevel is out of range. It must be >= 1 and <= 9.",
        ));
      }
      if mem_level != 8 {
        return Err(rquickjs::Exception::throw_message(
          ctx,
          "non-default zlib memLevel is not supported by the Rust backend",
        ));
      }
    }

    if let Some(strategy) = option::<i32>(&options, "strategy")? {
      if !(0..=4).contains(&strategy) {
        return Err(rquickjs::Exception::throw_type(
          ctx,
          "The value of options.strategy is invalid",
        ));
      }
      if strategy != 0 {
        return Err(rquickjs::Exception::throw_message(
          ctx,
          "non-default zlib strategy is not supported by the Rust backend",
        ));
      }
    }

    if option::<Value<'js>>(&options, "dictionary")?.is_some() {
      return Err(rquickjs::Exception::throw_message(
        ctx,
        "zlib dictionaries are not supported by the Rust backend",
      ));
    }

    if let Some(maximum) = option::<f64>(&options, "maxOutputLength")? {
      if !maximum.is_finite()
        || maximum < 1.0
        || maximum.fract() != 0.0
        || maximum > usize::MAX as f64
      {
        return Err(rquickjs::Exception::throw_range(
          ctx,
          "The value of options.maxOutputLength is out of range. It must be a positive integer.",
        ));
      }
      result.max_output_length = maximum as usize;
    }

    Ok(result)
  }
}

/// Like `Option<T>::from_js`, except JavaScript `null` remains a supplied
/// value and therefore fails normal type validation. Node treats only
/// `undefined` as an omitted option.
fn option<'js, T: FromJs<'js>>(options: &Object<'js>, name: &str) -> rquickjs::Result<Option<T>> {
  let value: Value<'js> = options.get(name)?;
  if value.is_undefined() {
    Ok(None)
  } else {
    T::from_js(&options.ctx(), value).map(Some)
  }
}

fn bytes_from_js<'js>(ctx: &Ctx<'js>, input: Object<'js>) -> rquickjs::Result<Vec<u8>> {
  input
    .as_typed_array::<u8>()
    .and_then(|value| value.as_bytes())
    .or_else(|| input.as_array_buffer().and_then(|value| value.as_bytes()))
    .map(ToOwned::to_owned)
    .ok_or_else(|| {
      rquickjs::Exception::throw_type(
        ctx,
        "The input argument must be an ArrayBuffer or an ArrayBufferView",
      )
    })
}

fn encode<W: Write>(
  mut encoder: W,
  input: &[u8],
  finish: impl FnOnce(W) -> io::Result<Vec<u8>>,
) -> io::Result<Vec<u8>> {
  encoder.write_all(input)?;
  finish(encoder)
}

fn decode<R: Read>(decoder: R, max_output_length: usize) -> io::Result<Vec<u8>> {
  let limit = max_output_length.saturating_add(1) as u64;
  let mut output = Vec::new();
  decoder.take(limit).read_to_end(&mut output)?;
  if output.len() > max_output_length {
    return Err(io::Error::new(
      io::ErrorKind::OutOfMemory,
      "Cannot create a Buffer larger than options.maxOutputLength",
    ));
  }
  Ok(output)
}

fn deflate_bytes(input: &[u8], options: &CodecOptions) -> io::Result<Vec<u8>> {
  encode(
    ZlibEncoder::new(Vec::new(), options.level),
    input,
    ZlibEncoder::finish,
  )
}

fn deflate_raw_bytes(input: &[u8], options: &CodecOptions) -> io::Result<Vec<u8>> {
  encode(
    DeflateEncoder::new(Vec::new(), options.level),
    input,
    DeflateEncoder::finish,
  )
}

fn gzip_bytes(input: &[u8], options: &CodecOptions) -> io::Result<Vec<u8>> {
  encode(
    GzEncoder::new(Vec::new(), options.level),
    input,
    GzEncoder::finish,
  )
}

fn inflate_bytes(input: &[u8], options: &CodecOptions) -> io::Result<Vec<u8>> {
  decode(
    ZlibDecoder::new(Cursor::new(input)),
    options.max_output_length,
  )
}

fn inflate_raw_bytes(input: &[u8], options: &CodecOptions) -> io::Result<Vec<u8>> {
  decode(
    DeflateDecoder::new(Cursor::new(input)),
    options.max_output_length,
  )
}

fn gunzip_bytes(input: &[u8], options: &CodecOptions) -> io::Result<Vec<u8>> {
  // Node accepts concatenated gzip members, so use MultiGzDecoder rather than
  // the single-member GzDecoder used by flate2's basic helper.
  decode(
    MultiGzDecoder::new(Cursor::new(input)),
    options.max_output_length,
  )
}

fn unzip_bytes(input: &[u8], options: &CodecOptions) -> io::Result<Vec<u8>> {
  if input.starts_with(&GZIP_MAGIC) {
    gunzip_bytes(input, options)
  } else {
    inflate_bytes(input, options)
  }
}

fn into_js_bytes<'js>(
  ctx: Ctx<'js>,
  operation: &'static str,
  result: io::Result<Vec<u8>>,
) -> rquickjs::Result<TypedArray<'js, u8>> {
  let bytes = result.map_err(|error| {
    rquickjs::Exception::throw_message(&ctx, &format!("{operation} failed: {error}"))
  })?;
  TypedArray::new(ctx, bytes)
}

macro_rules! codec_function {
  ($name:ident, $implementation:ident) => {
    fn $name<'js>(
      ctx: Ctx<'js>,
      input: Object<'js>,
      options: Opt<Object<'js>>,
    ) -> rquickjs::Result<TypedArray<'js, u8>> {
      let input = bytes_from_js(&ctx, input)?;
      let options = CodecOptions::from_js(&ctx, options)?;
      into_js_bytes(ctx, stringify!($name), $implementation(&input, &options))
    }
  };
}

codec_function!(deflate, deflate_bytes);
codec_function!(deflate_raw, deflate_raw_bytes);
codec_function!(gzip, gzip_bytes);
codec_function!(inflate, inflate_bytes);
codec_function!(inflate_raw, inflate_raw_bytes);
codec_function!(gunzip, gunzip_bytes);
codec_function!(unzip, unzip_bytes);

/// Construct the internal object loaded as `builtin:zlib-native` by the thin
/// JavaScript compatibility layer. This is deliberately not a public Node
/// builtin on its own.
pub fn native_module<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Object<'js>> {
  let module = Object::new(ctx.clone())?;
  module.set("deflate", Function::new(ctx.clone(), deflate)?)?;
  module.set("deflateRaw", Function::new(ctx.clone(), deflate_raw)?)?;
  module.set("gzip", Function::new(ctx.clone(), gzip)?)?;
  module.set("inflate", Function::new(ctx.clone(), inflate)?)?;
  module.set("inflateRaw", Function::new(ctx.clone(), inflate_raw)?)?;
  module.set("gunzip", Function::new(ctx.clone(), gunzip)?)?;
  module.set("unzip", Function::new(ctx.clone(), unzip)?)?;
  Ok(module)
}

#[cfg(test)]
mod tests {
  use super::*;

  const NODE_GZIP_ABC: &[u8] = &[
    0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x4b, 0x4c, 0x4a, 0x06, 0x00, 0xc2,
    0x41, 0x24, 0x35, 0x03, 0x00, 0x00, 0x00,
  ];
  const NODE_DEFLATE_ABC: &[u8] = &[
    0x78, 0x9c, 0x4b, 0x4c, 0x4a, 0x06, 0x00, 0x02, 0x4d, 0x01, 0x27,
  ];
  const NODE_DEFLATE_RAW_ABC: &[u8] = &[0x4b, 0x4c, 0x4a, 0x06, 0x00];

  #[test]
  fn decodes_node_vectors() {
    let options = CodecOptions::default();
    assert_eq!(inflate_bytes(NODE_DEFLATE_ABC, &options).unwrap(), b"abc");
    assert_eq!(
      inflate_raw_bytes(NODE_DEFLATE_RAW_ABC, &options).unwrap(),
      b"abc"
    );
    assert_eq!(gunzip_bytes(NODE_GZIP_ABC, &options).unwrap(), b"abc");
    assert_eq!(unzip_bytes(NODE_GZIP_ABC, &options).unwrap(), b"abc");
    assert_eq!(unzip_bytes(NODE_DEFLATE_ABC, &options).unwrap(), b"abc");
  }

  #[test]
  fn output_is_accepted_by_the_corresponding_decoders() {
    let input = b"the quick brown fox jumps over the lazy dog".repeat(128);
    let options = CodecOptions {
      level: Compression::best(),
      ..CodecOptions::default()
    };
    assert_eq!(
      inflate_bytes(&deflate_bytes(&input, &options).unwrap(), &options).unwrap(),
      input
    );
    assert_eq!(
      inflate_raw_bytes(&deflate_raw_bytes(&input, &options).unwrap(), &options).unwrap(),
      input
    );
    assert_eq!(
      gunzip_bytes(&gzip_bytes(&input, &options).unwrap(), &options).unwrap(),
      input
    );
  }

  #[test]
  fn gunzip_concatenates_members_like_node() {
    let options = CodecOptions::default();
    let mut members = gzip_bytes(b"first", &options).unwrap();
    members.extend(gzip_bytes(b"second", &options).unwrap());
    assert_eq!(gunzip_bytes(&members, &options).unwrap(), b"firstsecond");
  }

  #[test]
  fn enforces_max_output_length() {
    let compressed = deflate_bytes(b"0123456789", &CodecOptions::default()).unwrap();
    let options = CodecOptions {
      max_output_length: 9,
      ..CodecOptions::default()
    };
    assert_eq!(
      inflate_bytes(&compressed, &options).unwrap_err().kind(),
      io::ErrorKind::OutOfMemory
    );
  }

  /// Opt-in local benchmark used for before/after investigation. Kept ignored
  /// so normal test runs do not contain timing assertions or spend seconds on
  /// benchmark-sized buffers.
  #[test]
  #[ignore]
  fn benchmark_ten_megabytes() {
    use std::time::Instant;

    let input = b"parcel native zlib benchmark\n".repeat((10 * 1024 * 1024) / 29);
    let options = CodecOptions::default();
    let start = Instant::now();
    let compressed = deflate_bytes(&input, &options).unwrap();
    let deflate_time = start.elapsed();
    let start = Instant::now();
    let output = inflate_bytes(&compressed, &options).unwrap();
    let inflate_time = start.elapsed();
    assert_eq!(output, input);
    eprintln!(
      "native zlib 10 MiB: deflate={deflate_time:?}, inflate={inflate_time:?}, compressed={} bytes",
      compressed.len()
    );
  }
}
