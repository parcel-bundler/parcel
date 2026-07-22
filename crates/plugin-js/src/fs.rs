use std::{path::Path, sync::Arc};

use parcel_core::{DirEntry, FileKind, FileSystem};
use rquickjs::{
  Ctx, Exception, FromAtom, Function, IntoJs, JsLifetime, Promise, Value,
  class::{JsClass, Trace},
  function::Constructor,
  module::ModuleDef,
};

#[derive(JsLifetime, Trace, Clone)]
pub struct FileSystemData(#[qjs(skip_trace)] pub Arc<dyn FileSystem>);

#[derive(JsLifetime, Trace, Clone)]
#[rquickjs::class]
pub struct Fs {}

impl ModuleDef for Fs {
  fn declare<'js>(decl: &rquickjs::module::Declarations<'js>) -> rquickjs::Result<()> {
    decl.declare("default")?;
    Ok(())
  }

  fn evaluate<'js>(
    _ctx: &rquickjs::Ctx<'js>,
    exports: &rquickjs::module::Exports<'js>,
  ) -> rquickjs::Result<()> {
    exports.export("default", Fs {})?;
    Ok(())
  }
}

impl Fs {
  fn read_file_internal<'js>(
    ctx: Ctx<'js>,
    path: String,
    encoding: Option<String>,
  ) -> rquickjs::Result<Result<Value<'js>, Exception<'js>>> {
    let fs = ctx.userdata::<FileSystemData>().unwrap().0.clone();
    let encoding = encoding.as_ref().map(|e| e.as_str());
    match encoding {
      None => {
        let contents = fs.read(parcel_core::PathId::new(Path::new(&path)));
        match contents {
          Ok(contents) => {
            let buffer_ctor: rquickjs::Object = ctx.globals().get("Buffer")?;
            let buffer_from: Function = buffer_ctor.get("from")?;
            let array_buffer = rquickjs::ArrayBuffer::new(ctx, contents)?;
            let buffer: rquickjs::Value = buffer_from.call((array_buffer,))?;
            Ok(Ok(buffer))
          }
          Err(err) => Ok(Err(Exception::from_message(ctx, &err.to_string())?)),
        }
      }
      Some("utf-8") | Some("utf8") => {
        let contents = fs.read_to_string(parcel_core::PathId::new(Path::new(&path)));
        match contents {
          Ok(contents) => Ok(Ok(rquickjs::String::from_str(ctx, &contents)?.into_value())),
          Err(err) => Ok(Err(Exception::from_message(ctx, &err.to_string())?)),
        }
      }
      _ => Ok(Err(rquickjs::Exception::from_message(
        ctx,
        "Unsupported encoding",
      )?)),
    }
  }

  fn stat_internal<'js>(
    ctx: Ctx<'js>,
    path: String,
  ) -> rquickjs::Result<Result<Stats, Exception<'js>>> {
    let fs = ctx.userdata::<FileSystemData>().unwrap().0.clone();
    let stat = fs.stat(parcel_core::PathId::new(Path::new(&path)));
    match stat {
      Some(stat) => Ok(Ok(Stats::new(stat))),
      None => {
        let exception = rquickjs::Exception::from_message(
          ctx,
          &format!("ENOENT: no such file or directory, stat '{}'", path),
        )?;
        exception.set("code", "ENOENT")?;
        Ok(Err(exception))
      }
    }
  }

  fn lstat_internal<'js>(
    ctx: Ctx<'js>,
    path: String,
  ) -> rquickjs::Result<Result<Stats, Exception<'js>>> {
    let fs = ctx.userdata::<FileSystemData>().unwrap().0.clone();
    let stat = fs.lstat(parcel_core::PathId::new(Path::new(&path)));
    match stat {
      Some(stat) => Ok(Ok(Stats::new(stat))),
      None => {
        let exception = rquickjs::Exception::from_message(
          ctx,
          &format!("ENOENT: no such file or directory, stat '{}'", path),
        )?;
        exception.set("code", "ENOENT")?;
        Ok(Err(exception))
      }
    }
  }

  fn readdir_internal<'js>(
    ctx: Ctx<'js>,
    path: String,
    options: Option<&Value>,
  ) -> rquickjs::Result<Result<Vec<Value<'js>>, Exception<'js>>> {
    let fs = ctx.userdata::<FileSystemData>().unwrap().0.clone();
    let entries = fs.read_dir(parcel_core::PathId::new(Path::new(&path)));
    let mut with_file_types = false;
    if let Some(options) = options {
      if let Some(obj) = options.as_object() {
        with_file_types = obj
          .get::<_, Value>("withFileTypes")
          .ok()
          .and_then(|v| v.as_bool())
          .unwrap_or_default();
      }
    };

    match entries {
      Ok(entries) => {
        if with_file_types {
          let result = entries
            .into_iter()
            .map(|entry| {
              Ok(
                rquickjs::Class::instance(
                  ctx.clone(),
                  Dirent {
                    entry,
                    parent_path: path.clone(),
                  },
                )?
                .into_value(),
              )
            })
            .collect::<Result<Vec<_>, rquickjs::Error>>()?;
          Ok(Ok(result))
        } else {
          let result = entries
            .into_iter()
            .map(|entry| {
              Ok(
                rquickjs::String::from_str(ctx.clone(), &entry.name.to_string_lossy())?
                  .into_value(),
              )
            })
            .collect::<Result<Vec<_>, rquickjs::Error>>()?;
          Ok(Ok(result))
        }
      }
      Err(err) => Ok(Err(Exception::from_message(ctx, &err.to_string())?)),
    }
  }

  fn realpath_internal<'js>(
    ctx: Ctx<'js>,
    path: String,
  ) -> rquickjs::Result<Result<String, Exception<'js>>> {
    let fs = ctx.userdata::<FileSystemData>().unwrap().0.clone();
    match fs.canonicalize(parcel_core::PathId::new(Path::new(&path))) {
      Ok(link) => Ok(Ok(link.to_path_buf().to_string_lossy().into_owned())),
      Err(e) => Ok(Err(Exception::from_message(ctx, &e.to_string())?)),
    }
  }

  fn readlink_internal<'js>(
    ctx: Ctx<'js>,
    path: String,
  ) -> rquickjs::Result<Result<String, Exception<'js>>> {
    let fs = ctx.userdata::<FileSystemData>().unwrap().0.clone();
    match fs.read_link(parcel_core::PathId::new(Path::new(&path))) {
      Ok(link) => Ok(Ok(link.to_path_buf().to_string_lossy().into_owned())),
      Err(e) => Ok(Err(Exception::from_message(ctx, &e.to_string())?)),
    }
  }
}

fn handle_sync<'js, V: IntoJs<'js>>(
  ctx: &Ctx<'js>,
  result: Result<V, Exception<'js>>,
) -> rquickjs::Result<Value<'js>> {
  match result {
    Ok(value) => value.into_js(ctx),
    Err(exception) => Err(exception.throw()),
  }
}

fn handle_async<'js, V: IntoJs<'js>>(
  callback: &Function<'js>,
  result: Result<V, Exception<'js>>,
) -> rquickjs::Result<()> {
  match result {
    Ok(res) => callback.call((rquickjs::Null, res)),
    Err(exception) => callback.call((exception, rquickjs::Null)),
  }
}

#[rquickjs::methods(rename_all = "camelCase")]
impl Fs {
  #[qjs(get, rename = "Stats")]
  pub fn stats<'js>(ctx: Ctx<'js>) -> rquickjs::Result<Option<Constructor<'js>>> {
    Stats::constructor(&ctx)
  }

  #[qjs(get)]
  fn promises<'js>() -> FsPromises {
    FsPromises {}
  }

  pub fn read_file_sync<'js>(
    ctx: Ctx<'js>,
    path: String,
    encoding: rquickjs::function::Opt<String>,
  ) -> rquickjs::Result<Value<'js>> {
    handle_sync(&ctx, Fs::read_file_internal(ctx.clone(), path, encoding.0)?)
  }

  pub fn read_file<'js>(
    ctx: Ctx<'js>,
    path: String,
    rest: rquickjs::function::Rest<Value<'js>>,
  ) -> rquickjs::Result<()> {
    let (encoding, callback) = if rest.0.len() >= 2 {
      (
        rest.0[0].as_string().and_then(|s| s.to_string().ok()),
        rest.0[1].as_function(),
      )
    } else {
      (None, rest.0.first().and_then(|v| v.as_function()))
    };
    let Some(callback) = callback else {
      return Err(rquickjs::Exception::throw_message(
        &ctx,
        "Required callback not provided",
      ));
    };

    handle_async(
      callback,
      Fs::read_file_internal(ctx.clone(), path, encoding)?,
    )
  }

  pub fn stat_sync<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<Value<'js>> {
    handle_sync(&ctx, Fs::stat_internal(ctx.clone(), path)?)
  }

  pub fn lstat_sync<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<Value<'js>> {
    handle_sync(&ctx, Fs::lstat_internal(ctx.clone(), path)?)
  }

  pub fn stat<'js>(ctx: Ctx<'js>, path: String, callback: Function<'js>) -> rquickjs::Result<()> {
    handle_async(&callback, Fs::stat_internal(ctx.clone(), path)?)
  }

  pub fn lstat<'js>(ctx: Ctx<'js>, path: String, callback: Function<'js>) -> rquickjs::Result<()> {
    handle_async(&callback, Fs::lstat_internal(ctx.clone(), path)?)
  }

  pub fn realpath<'js>(
    ctx: Ctx<'js>,
    path: String,
    rest: rquickjs::function::Rest<Value<'js>>,
  ) -> rquickjs::Result<()> {
    let (_encoding, callback) = if rest.0.len() >= 2 {
      (rest.0[0].as_string(), rest.0[1].as_function())
    } else {
      (None, rest.0.first().and_then(|v| v.as_function()))
    };

    let Some(callback) = callback else {
      return Err(rquickjs::Exception::throw_message(
        &ctx,
        "Required callback not provided",
      ));
    };

    handle_async(&callback, Fs::realpath_internal(ctx.clone(), path)?)
  }

  pub fn realpath_sync<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<Value<'js>> {
    handle_sync(&ctx, Fs::realpath_internal(ctx.clone(), path)?)
  }

  pub fn readlink<'js>(
    ctx: Ctx<'js>,
    path: String,
    rest: rquickjs::function::Rest<Value<'js>>,
  ) -> rquickjs::Result<()> {
    let (_encoding, callback) = if rest.0.len() >= 2 {
      (rest.0[0].as_string(), rest.0[1].as_function())
    } else {
      (None, rest.0.first().and_then(|v| v.as_function()))
    };

    let Some(callback) = callback else {
      return Err(rquickjs::Exception::throw_message(
        &ctx,
        "Required callback not provided",
      ));
    };

    handle_async(&callback, Fs::readlink_internal(ctx.clone(), path)?)
  }

  pub fn readlink_sync<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<Value<'js>> {
    handle_sync(&ctx, Fs::readlink_internal(ctx.clone(), path)?)
  }

  pub fn readdir_sync<'js>(
    ctx: Ctx<'js>,
    path: String,
    options: rquickjs::function::Opt<Value<'js>>,
  ) -> rquickjs::Result<Value<'js>> {
    handle_sync(
      &ctx,
      Fs::readdir_internal(ctx.clone(), path, options.0.as_ref())?,
    )
  }

  pub fn readdir<'js>(
    ctx: Ctx<'js>,
    path: String,
    rest: rquickjs::function::Rest<Value<'js>>,
  ) -> rquickjs::Result<()> {
    let (options, callback) = if rest.0.len() >= 2 {
      (Some(&rest.0[0]), rest.0[1].as_function())
    } else {
      (None, rest.0.first().and_then(|v| v.as_function()))
    };
    let Some(callback) = callback else {
      return Err(rquickjs::Exception::throw_message(
        &ctx,
        "Required callback not provided",
      ));
    };

    handle_async(&callback, Fs::readdir_internal(ctx.clone(), path, options)?)
  }

  pub fn open<'js>(_ctx: Ctx<'js>, path: String, _rest: rquickjs::function::Rest<Value<'js>>) {
    println!("Open {}", path);
  }

  pub fn close() {}
}

#[derive(JsLifetime, Trace, Clone)]
#[rquickjs::class]
pub struct FsPromises {}

fn to_promise<'js, V: IntoJs<'js>>(
  ctx: &Ctx<'js>,
  result: Result<V, Exception<'js>>,
) -> rquickjs::Result<Promise<'js>> {
  let (promise, resolve, reject) = Promise::new(ctx)?;
  match result {
    Ok(value) => {
      resolve.call::<_, Value>((value,))?;
    }
    Err(exception) => {
      reject.call::<_, Value>((exception,))?;
    }
  }
  Ok(promise)
}

#[rquickjs::methods(rename_all = "camelCase")]
impl FsPromises {
  #[qjs(get, rename = "Stats")]
  pub fn stats<'js>(ctx: Ctx<'js>) -> rquickjs::Result<Option<Constructor<'js>>> {
    Stats::constructor(&ctx)
  }

  pub fn read_file<'js>(
    ctx: Ctx<'js>,
    path: String,
    encoding: rquickjs::function::Opt<String>,
  ) -> rquickjs::Result<Promise<'js>> {
    to_promise(&ctx, Fs::read_file_internal(ctx.clone(), path, encoding.0)?)
  }

  pub fn stat<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<Promise<'js>> {
    to_promise(&ctx, Fs::stat_internal(ctx.clone(), path)?)
  }

  pub fn lstat<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<Promise<'js>> {
    to_promise(&ctx, Fs::lstat_internal(ctx.clone(), path)?)
  }

  pub fn realpath<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<Promise<'js>> {
    to_promise(&ctx, Fs::realpath_internal(ctx.clone(), path)?)
  }

  pub fn readlink<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<Promise<'js>> {
    to_promise(&ctx, Fs::readlink_internal(ctx.clone(), path)?)
  }

  pub fn readdir<'js>(
    ctx: Ctx<'js>,
    path: String,
    options: rquickjs::function::Opt<Value<'js>>,
  ) -> rquickjs::Result<Promise<'js>> {
    to_promise(
      &ctx,
      Fs::readdir_internal(ctx.clone(), path, options.0.as_ref())?,
    )
  }

  pub fn open<'js>(_ctx: Ctx<'js>, path: String, _rest: rquickjs::function::Rest<Value<'js>>) {
    println!("Open {}", path);
  }

  pub fn close() {}
}

impl ModuleDef for FsPromises {
  fn declare<'js>(decl: &rquickjs::module::Declarations<'js>) -> rquickjs::Result<()> {
    decl.declare("default")?;
    Ok(())
  }

  fn evaluate<'js>(
    _ctx: &rquickjs::Ctx<'js>,
    exports: &rquickjs::module::Exports<'js>,
  ) -> rquickjs::Result<()> {
    exports.export("default", FsPromises {})?;
    Ok(())
  }
}

pub fn get_dirname<'js>(ctx: Ctx<'js>) -> rquickjs::Result<Value<'js>> {
  let from = ctx.script_or_module_name(0).unwrap();
  let from = from.to_string().unwrap();
  let path = Path::new(&from);
  let parent = path.parent().unwrap().to_str().unwrap();
  Ok(rquickjs::String::from_str(ctx, parent)?.into_value())
}

pub fn get_filename<'js>(ctx: Ctx<'js>) -> rquickjs::Result<Value<'js>> {
  let from = ctx.script_or_module_name(0).unwrap();
  Ok(rquickjs::String::from_atom(from)?.into_value())
}

/// A struct representing `fs.Stats` from Node.js.
/// Fields not available from the underlying filesystem default to 0.
#[derive(JsLifetime, Trace, Clone)]
#[rquickjs::class(rename_all = "camelCase")]
pub struct Stats {
  #[qjs(get)]
  dev: u64,
  #[qjs(get)]
  mode: u32,
  #[qjs(get)]
  nlink: i32,
  #[qjs(get)]
  uid: u32,
  #[qjs(get)]
  gid: u32,
  #[qjs(get)]
  rdev: u64,
  #[qjs(get)]
  size: u64,
  #[qjs(get)]
  blksize: i32,
  #[qjs(get)]
  blocks: i32,
  #[qjs(get)]
  atime_ms: f64,
  #[qjs(get)]
  mtime_ms: f64,
  #[qjs(get)]
  ctime_ms: f64,
  #[qjs(get)]
  birthtime_ms: f64,
}

// Node.js stat modes: S_IFREG = 0o100000, S_IFDIR = 0o040000
const S_IFREG: u32 = 0o100000;
const S_IFDIR: u32 = 0o040000;
const S_IFLNK: u32 = 0o120000;
const S_IRUSR: u32 = 0o0400;
const S_IWUSR: u32 = 0o0200;
const S_IRGRP: u32 = 0o0040;
const S_IWGRP: u32 = 0o0020;

impl Stats {
  /// Create a new Stats instance from a FileStat.
  /// Unavailable fields are set to 0. Timestamps of -1 are converted to 0.
  pub fn new(stat: parcel_core::FileStat) -> Self {
    let is_dir = stat.kind.contains(FileKind::IS_DIR);
    let is_file = stat.kind.contains(FileKind::IS_FILE);
    let is_symlink = stat.kind.contains(FileKind::IS_SYMLINK);
    let mut mode = S_IRUSR | S_IWUSR | S_IRGRP | S_IWGRP;
    if is_dir {
      mode |= S_IFDIR;
    }
    if is_file {
      mode |= S_IFREG;
    }
    if is_symlink {
      mode |= S_IFLNK;
    }

    // Convert timestamps: -1 (unavailable) becomes 0
    let to_ms = |val: i64| -> f64 { if val < 0 { 0.0 } else { val as f64 } };

    Self {
      dev: 0,
      mode,
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      size: stat.size,
      blksize: -1_i32 as i32,
      blocks: -1_i32 as i32,
      atime_ms: to_ms(stat.atime),
      mtime_ms: to_ms(stat.mtime),
      ctime_ms: to_ms(stat.ctime),
      birthtime_ms: to_ms(stat.birthtime),
    }
  }
}

#[rquickjs::methods(rename_all = "camelCase")]
impl Stats {
  #[qjs(constructor)]
  fn create() -> Stats {
    Stats {
      dev: 0,
      mode: 0,
      nlink: 0,
      uid: 0,
      gid: 0,
      rdev: 0,
      size: 0,
      blksize: 0,
      blocks: 0,
      atime_ms: 0.0,
      mtime_ms: 0.0,
      ctime_ms: 0.0,
      birthtime_ms: 0.0,
    }
  }

  fn is_directory(&self) -> bool {
    (self.mode & S_IFDIR) == S_IFDIR
  }

  fn is_file(&self) -> bool {
    (self.mode & S_IFREG) == S_IFREG
  }

  fn is_symbolic_link(&self) -> bool {
    (self.mode & S_IFLNK) == S_IFLNK
  }

  #[qjs(get)]
  fn atime<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<Value<'js>> {
    let ms = self.atime_ms;
    let date_ctor: Constructor = ctx.globals().get("Date")?;
    date_ctor.construct((ms,))
  }

  #[qjs(get)]
  fn mtime<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<Value<'js>> {
    let ms = self.mtime_ms;
    let date_ctor: Constructor = ctx.globals().get("Date")?;
    date_ctor.construct((ms,))
  }

  #[qjs(get)]
  fn ctime<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<Value<'js>> {
    let ms = self.ctime_ms;
    let date_ctor: Constructor = ctx.globals().get("Date")?;
    date_ctor.construct((ms,))
  }
}

#[derive(JsLifetime, Trace)]
#[rquickjs::class(rename_all = "camelCase")]
pub struct Dirent {
  #[qjs(skip_trace)]
  entry: DirEntry,
  #[qjs(get, skip_trace)]
  parent_path: String,
}

#[rquickjs::methods(rename_all = "camelCase")]
impl Dirent {
  fn is_block_device() -> bool {
    false
  }

  fn is_character_device() -> bool {
    false
  }

  fn is_directory(&self) -> bool {
    self.entry.kind.contains(FileKind::IS_DIR)
  }

  fn is_file(&self) -> bool {
    self.entry.kind.contains(FileKind::IS_FILE)
  }

  #[qjs(rename = "isFIFO")]
  fn is_fifo() -> bool {
    false
  }

  fn is_socket() -> bool {
    false
  }

  fn is_symbolic_link(&self) -> bool {
    self.entry.kind.contains(FileKind::IS_SYMLINK)
  }

  #[qjs(get)]
  fn name(&self) -> String {
    self.entry.name.to_string_lossy().into_owned()
  }
}
