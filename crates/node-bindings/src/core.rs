use std::sync::{Arc, Mutex};

use crossbeam_channel::{Receiver, Sender};
use napi::{
  bindgen_prelude::{BigInt, Buffer},
  threadsafe_function::{ThreadSafeCallContext, ThreadsafeFunctionCallMode},
  Env, JsFunction, JsObject, JsUnknown,
};
use napi_derive::napi;
use parcel_core::{
  cache::{Cache, MemoryCache},
  types::{BaseParcelOptions, ParcelOptions},
  worker_farm::{WorkerError, WorkerFarm, WorkerRequest, WorkerResult},
};
use parcel_core::{request_tracker::FileEvent, worker_farm::WorkerCallback, Parcel};
use parcel_resolver::{FileSystem, OsFileSystem};

use crate::{resolver::JsFileSystem, utils::create_js_thread_safe_method};

// Allocate a single channel per thread to communicate with the JS thread.
thread_local! {
  static CHANNEL: (Sender<Result<WorkerResult, WorkerError>>, Receiver<Result<WorkerResult, WorkerError>>) = crossbeam_channel::unbounded();
}

/// Creates a macro callback from a JS function.
fn create_worker_callback(function: JsFunction, env: Env) -> napi::Result<WorkerCallback> {
  let tsfn =
    env.create_threadsafe_function(&function, 0, |ctx: ThreadSafeCallContext<WorkerRequest>| {
      let value = ctx.env.to_js_value(&ctx.value);
      Ok(vec![value])
    })?;

  // Get around Env not being Send. See safety note below.
  let unsafe_env = env.raw() as usize;

  Ok(Arc::new(move |request| {
    CHANNEL.with(|channel| {
      // Call JS function to run the macro.
      let tx = channel.0.clone();
      tsfn.call_with_return_value(
        Ok(request),
        ThreadsafeFunctionCallMode::Blocking,
        move |v: JsUnknown| {
          // When the JS function returns, await the promise, and send the result
          // through the channel back to the native thread.
          // SAFETY: this function is called from the JS thread.
          await_promise(unsafe { Env::from_raw(unsafe_env as _) }, v, tx)?;
          Ok(())
        },
      );
      // Lock the transformer thread until the JS thread returns a result.
      channel.1.recv().expect("receive failure")
    })
  }))
}

fn await_promise(
  env: Env,
  result: JsUnknown,
  tx: Sender<Result<WorkerResult, WorkerError>>,
) -> napi::Result<()> {
  // If the result is a promise, wait for it to resolve, and send the result to the channel.
  // Otherwise, send the result immediately.
  if result.is_promise()? {
    let result: JsObject = result.try_into()?;
    let then: JsFunction = result.get_named_property("then")?;
    let tx2 = tx.clone();
    let cb = env.create_function_from_closure("callback", move |ctx| {
      let res = ctx.env.from_js_value(ctx.get::<JsUnknown>(0)?)?;
      tx.send(Ok(res)).expect("send failure");
      ctx.env.get_undefined()
    })?;
    let eb = env.create_function_from_closure("error_callback", move |ctx| {
      let err = ctx.env.from_js_value(ctx.get::<JsUnknown>(0)?)?;
      tx2.send(Err(err)).expect("send failure");
      ctx.env.get_undefined()
    })?;
    then.call(Some(&result), &[cb, eb])?;
  } else {
    let res = env.from_js_value(result)?;
    tx.send(Ok(res)).expect("send failure");
  }

  Ok(())
}

#[napi]
pub struct ParcelRust {
  parcel: Arc<Mutex<Parcel>>,
}

#[napi]
impl ParcelRust {
  #[napi(constructor)]
  pub fn new(
    entries: Vec<String>,
    options: JsObject,
    callback: JsFunction,
    env: Env,
  ) -> napi::Result<Self> {
    let mut farm = WorkerFarm::new();
    farm.register_worker(create_worker_callback(callback, env)?);

    let fs: Option<JsObject> = options.get_named_property("fs")?;
    let cache: JsObject = options.get_named_property("cache")?;
    let options: BaseParcelOptions = env.from_js_value(options)?;
    let fs: Arc<dyn FileSystem> = match fs {
      Some(fs) => Arc::new(JsFileSystem::new(&env, &fs)?),
      None => Arc::new(OsFileSystem::default()),
    };
    let cache = Arc::new(JsCache::new(&env, &cache)?);
    let options = ParcelOptions::new(options, fs, cache);

    Ok(ParcelRust {
      parcel: Arc::new(Mutex::new(Parcel::new(entries, farm, options))),
    })
  }

  #[napi]
  pub fn next_build(&mut self, events: JsUnknown, env: Env) -> napi::Result<bool> {
    let events: Vec<FileEvent> = env.from_js_value(events)?;
    let mut parcel = self.parcel.lock().unwrap();
    let invalidated = parcel.next_build(events);
    Ok(invalidated)
  }

  #[napi]
  pub fn build_asset_graph(&self, env: Env) -> napi::Result<JsObject> {
    let (deferred, promise) = env.create_deferred()?;
    let parcel = Arc::clone(&self.parcel);
    rayon::spawn(move || {
      let mut parcel = parcel.lock().unwrap();
      let asset_graph = parcel.build_asset_graph();
      deferred.resolve(move |env| env.to_js_value(&asset_graph));
    });

    Ok(promise)
  }

  #[napi]
  pub fn read_from_cache(&self, key: String) {
    let mut parcel = self.parcel.lock().unwrap();
    parcel.read_from_cache(key);
  }

  #[napi]
  pub fn write_to_cache(&self, key: String) {
    let parcel = self.parcel.lock().unwrap();
    parcel.write_to_cache(key);
  }
}

#[napi]
pub struct RustCache {
  cache: Arc<MemoryCache>,
}

#[napi]
impl RustCache {
  #[napi(constructor)]
  pub fn new() -> Self {
    RustCache {
      cache: Arc::new(MemoryCache::new()),
    }
  }

  #[napi]
  pub fn has(&self, key: String) -> bool {
    self.cache.has(key)
  }

  #[napi]
  pub fn get_blob(&self, key: String) -> Option<Buffer> {
    self.cache.get(key).map(|b| b.clone().into())
  }

  #[napi]
  pub fn set_blob(&mut self, key: String, value: Buffer) {
    self.cache.set(key, value.into());
  }

  #[napi]
  pub fn set(&mut self) {}

  #[napi]
  pub fn get(&self) {}

  #[napi]
  pub fn ensure(&mut self) {}

  #[napi]
  pub fn serialize(&self) -> SerializedCache {
    SerializedCache {
      id: BigInt::from(Arc::as_ptr(&self.cache) as u64),
    }
  }

  #[napi(factory)]
  pub fn deserialize(value: SerializedCache) -> Self {
    let ptr = value.id.words[0] as *const MemoryCache;
    let cache = unsafe {
      Arc::increment_strong_count(ptr);
      Arc::from_raw(ptr)
    };
    Self { cache }
  }
}

#[napi(object)]
pub struct SerializedCache {
  pub id: BigInt,
}

struct JsCache {
  get: Box<dyn Fn(String) -> napi::Result<crate::utils::Buffer> + Send + Sync>,
  has: Box<dyn Fn(String) -> napi::Result<bool> + Send + Sync>,
  set: Box<dyn Fn((String, crate::utils::Buffer)) -> napi::Result<()> + Send + Sync>,
}

impl JsCache {
  fn new(env: &Env, obj: &JsObject) -> napi::Result<Self> {
    Ok(Self {
      get: Box::new(create_js_thread_safe_method(env, obj, "getBlob")?),
      has: Box::new(create_js_thread_safe_method(env, obj, "has")?),
      set: Box::new(create_js_thread_safe_method(env, obj, "setBlob")?),
    })
  }
}

impl Cache for JsCache {
  fn get(&self, key: String) -> Option<Vec<u8>> {
    (*self.get)(key).ok().map(|v| v.0)
  }

  fn has(&self, key: String) -> bool {
    (*self.has)(key).unwrap_or_default()
  }

  fn set(&self, key: String, value: Vec<u8>) {
    let _ = (*self.set)((key, crate::utils::Buffer(value)));
  }
}
