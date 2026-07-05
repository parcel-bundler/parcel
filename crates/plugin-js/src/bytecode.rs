use std::{
  collections::HashMap,
  ffi::CString,
  hash::{DefaultHasher, Hash, Hasher},
  sync::{Arc, LazyLock, RwLock},
};

use rquickjs::{Ctx, Value, qjs};

/// Serialized QuickJS bytecode for loaded modules, keyed by resolved path and validated against a
/// hash of the source.
///
/// Each worker thread has its own QuickJS runtime (see `JS_ENV` in `lib.rs`), so without this
/// cache every thread re-parses the same module graph. QuickJS bytecode is runtime-independent,
/// so the first thread to load a module compiles it once and every other thread deserializes
/// the bytecode instead.
///
/// Scripts (CommonJS wrappers, `JS_TAG_FUNCTION_BYTECODE`) and ES modules (`JS_TAG_MODULE`) are
/// kept in separate namespaces: the same path can legitimately be loaded both ways, and the
/// deserializer must know which tag to expect.
static CACHE: LazyLock<[RwLock<HashMap<String, Entry>>; 2]> = LazyLock::new(Default::default);

struct Entry {
  source_hash: SourceHash,
  bytes: Arc<[u8]>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct SourceHash(u64);

#[derive(Clone, Copy)]
pub enum Kind {
  Script,
  Module,
}

pub fn source_hash(source: &str) -> SourceHash {
  let mut hasher = DefaultHasher::new();
  source.hash(&mut hasher);
  SourceHash(hasher.finish())
}

pub fn get(kind: Kind, path: &str, source_hash: SourceHash) -> Option<Arc<[u8]>> {
  let entry = CACHE[kind as usize].read().unwrap();
  let entry = entry.get(path)?;
  if entry.source_hash != source_hash {
    return None;
  }
  Some(entry.bytes.clone())
}

pub fn insert(kind: Kind, path: &str, source_hash: SourceHash, bytes: Arc<[u8]>) {
  CACHE[kind as usize]
    .write()
    .unwrap()
    .insert(path.to_owned(), Entry { source_hash, bytes });
}

/// Runs a compiled-but-unevaluated script object (`JS_TAG_FUNCTION_BYTECODE`), returning the
/// script's completion value. Consumes `compiled`.
unsafe fn eval_compiled<'js>(
  ctx: &Ctx<'js>,
  compiled: qjs::JSValue,
) -> rquickjs::Result<Value<'js>> {
  unsafe {
    let val = qjs::JS_EvalFunction(ctx.as_raw().as_ptr(), compiled);
    if qjs::JS_VALUE_GET_TAG(val) == qjs::JS_TAG_EXCEPTION {
      return Err(rquickjs::Error::Exception);
    }
    Ok(Value::from_raw(ctx.clone(), val))
  }
}

/// Compiles `code` as a non-strict global script, caches its bytecode under `path`, and runs it,
/// returning the script's completion value. Equivalent to `ctx.eval_with_options` with
/// `strict: false` and `filename: path`, plus the bytecode side effect. `source_hash` is the hash
/// of the original source `code` was derived from (see [`source_hash`]).
pub fn compile_script<'js>(
  ctx: &Ctx<'js>,
  path: &str,
  source_hash: SourceHash,
  code: &str,
) -> rquickjs::Result<Value<'js>> {
  let src = CString::new(code)?;
  let filename = CString::new(path)?;
  unsafe {
    let compiled = qjs::JS_Eval(
      ctx.as_raw().as_ptr(),
      src.as_ptr(),
      code.len() as _,
      filename.as_ptr(),
      (qjs::JS_EVAL_TYPE_GLOBAL | qjs::JS_EVAL_FLAG_COMPILE_ONLY) as i32,
    );
    if qjs::JS_VALUE_GET_TAG(compiled) == qjs::JS_TAG_EXCEPTION {
      return Err(rquickjs::Error::Exception);
    }

    let mut len: qjs::size_t = 0;
    let buf = qjs::JS_WriteObject(
      ctx.as_raw().as_ptr(),
      &mut len,
      compiled,
      qjs::JS_WRITE_OBJ_BYTECODE as i32,
    );
    if buf.is_null() {
      qjs::JS_FreeValue(ctx.as_raw().as_ptr(), compiled);
      return Err(rquickjs::Error::Exception);
    }
    insert(
      Kind::Script,
      path,
      source_hash,
      Arc::from(std::slice::from_raw_parts(buf, len as usize)),
    );
    qjs::js_free(ctx.as_raw().as_ptr(), buf as _);

    eval_compiled(ctx, compiled)
  }
}

/// Runs the script previously cached under `path` (see [`compile_script`]), returning the script's
/// completion value, or `None` if no bytecode is cached for this path and source.
pub fn load_script<'js>(
  ctx: &Ctx<'js>,
  path: &str,
  source_hash: SourceHash,
) -> Option<rquickjs::Result<Value<'js>>> {
  let bytes = get(Kind::Script, path, source_hash)?;
  unsafe {
    let compiled = qjs::JS_ReadObject(
      ctx.as_raw().as_ptr(),
      bytes.as_ptr(),
      bytes.len() as _,
      qjs::JS_READ_OBJ_BYTECODE as i32,
    );
    if qjs::JS_VALUE_GET_TAG(compiled) == qjs::JS_TAG_EXCEPTION {
      return Some(Err(rquickjs::Error::Exception));
    }
    Some(eval_compiled(ctx, compiled))
  }
}
