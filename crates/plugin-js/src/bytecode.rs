use std::{
  collections::HashMap,
  ffi::CString,
  hash::{DefaultHasher, Hash, Hasher},
  sync::{Arc, LazyLock, Mutex, MutexGuard, RwLock},
};

use rquickjs::{
  Ctx, Module, Value,
  module::{Declared, WriteOptions},
  qjs,
};

/// Serialized QuickJS bytecode for loaded modules, keyed by resolved path and validated against a
/// hash of the source.
///
/// Each worker thread has its own QuickJS runtime (see `JS_ENV` in `lib.rs`), so without this
/// cache every thread re-parses the same module graph. QuickJS bytecode is runtime-independent,
/// so the first thread to load a module compiles it once and every other thread deserializes
/// the bytecode instead (for scripts, waiting for it if that thread is still compiling; see
/// [`COMPILING`]).
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
enum Kind {
  Script,
  Module,
}

pub fn source_hash(source: &str) -> SourceHash {
  let mut hasher = DefaultHasher::new();
  source.hash(&mut hasher);
  SourceHash(hasher.finish())
}

fn get(kind: Kind, path: &str, source_hash: SourceHash) -> Option<Arc<[u8]>> {
  let entry = CACHE[kind as usize].read().unwrap();
  let entry = entry.get(path)?;
  if entry.source_hash != source_hash {
    return None;
  }
  Some(entry.bytes.clone())
}

fn insert(kind: Kind, path: &str, source_hash: SourceHash, bytes: Arc<[u8]>) {
  CACHE[kind as usize]
    .write()
    .unwrap()
    .insert(path.to_owned(), Entry { source_hash, bytes });
}

/// Held while compiling a script, so that other threads loading it wait for its bytecode rather
/// than compiling it too. Threads tend to load the same modules at the same time: each one's
/// first call into a plugin or macro loads its whole module graph.
///
/// Striped by path; scripts sharing a stripe only wait for each other's (brief) compile. Only held
/// while transpiling and compiling, never while running JS or loading other modules, so a thread
/// holding it never waits for another (see [`declare_module`]).
static COMPILING: [Mutex<()>; 64] = [const { Mutex::new(()) }; 64];

fn compiling(path: &str) -> MutexGuard<'static, ()> {
  let mut hasher = DefaultHasher::new();
  path.hash(&mut hasher);
  let stripe = &COMPILING[hasher.finish() as usize % COMPILING.len()];
  // Nothing it guards can be left inconsistent by a panic.
  stripe.lock().unwrap_or_else(|e| e.into_inner())
}

/// Declares the ES module at `path` from its cached bytecode, or else compiles `source()` (the
/// module's code, e.g. after transpiling TypeScript) and caches it. `source_hash` is the hash of
/// the original source (see [`source_hash`]).
///
/// Unlike scripts, threads that load a module at the same time may each compile it: declaring a
/// module loads its imports, which could be waiting for this thread (e.g. an import cycle loaded
/// from two threads), so it can't be done while holding a lock.
pub fn declare_module<'js>(
  ctx: &Ctx<'js>,
  path: &str,
  source_hash: SourceHash,
  source: impl FnOnce() -> rquickjs::Result<String>,
) -> rquickjs::Result<Module<'js, Declared>> {
  if let Some(bytes) = get(Kind::Module, path, source_hash) {
    // SAFETY: the bytes were produced by `Module::write` below for this same source.
    return unsafe { Module::load(ctx.clone(), &bytes) };
  }
  let module = Module::declare(ctx.clone(), path, source()?)?;
  let bytes = module.write(WriteOptions::default())?;
  insert(Kind::Module, path, source_hash, bytes.into());
  Ok(module)
}

/// Runs the script at `path` (non-strict, global) from its cached bytecode, or else compiles
/// `code()` (the script, e.g. a CommonJS wrapper) and caches it, returning the script's completion
/// value. `source_hash` is the hash of the original source `code` is derived from (see
/// [`source_hash`]).
pub fn run_script<'js>(
  ctx: &Ctx<'js>,
  path: &str,
  source_hash: SourceHash,
  code: impl FnOnce() -> rquickjs::Result<String>,
) -> rquickjs::Result<Value<'js>> {
  // Compiled while holding the lock, but run after releasing it.
  let compiled = match get(Kind::Script, path, source_hash) {
    Some(bytes) => read_script(ctx, &bytes)?,
    None => {
      let _compiling = compiling(path);
      match get(Kind::Script, path, source_hash) {
        // Compiled by another thread while this one waited.
        Some(bytes) => read_script(ctx, &bytes)?,
        None => compile_script(ctx, path, source_hash, &code()?)?,
      }
    }
  };
  // SAFETY: `compiled` is an unevaluated script, owned here.
  unsafe { eval_compiled(ctx, compiled.0) }
}

/// A compiled-but-unevaluated script object (`JS_TAG_FUNCTION_BYTECODE`).
struct CompiledScript(qjs::JSValue);

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

/// Compiles `code` as a non-strict global script and caches its bytecode under `path`.
fn compile_script(
  ctx: &Ctx<'_>,
  path: &str,
  source_hash: SourceHash,
  code: &str,
) -> rquickjs::Result<CompiledScript> {
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
    Ok(CompiledScript(compiled))
  }
}

/// Deserializes a script compiled by [`compile_script`].
fn read_script(ctx: &Ctx<'_>, bytes: &[u8]) -> rquickjs::Result<CompiledScript> {
  unsafe {
    let compiled = qjs::JS_ReadObject(
      ctx.as_raw().as_ptr(),
      bytes.as_ptr(),
      bytes.len() as _,
      qjs::JS_READ_OBJ_BYTECODE as i32,
    );
    if qjs::JS_VALUE_GET_TAG(compiled) == qjs::JS_TAG_EXCEPTION {
      return Err(rquickjs::Error::Exception);
    }
    Ok(CompiledScript(compiled))
  }
}
