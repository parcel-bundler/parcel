use std::{path::Path, sync::Arc};

use parcel_core::{DirEntry, FileKind, FileSystem, PathId};
use rquickjs::{
  Ctx, Exception, FromAtom, Function, IntoJs, JsLifetime, Promise, Value,
  class::{JsClass, Trace},
  function::Constructor,
  module::ModuleDef,
};

#[derive(JsLifetime, Trace, Clone)]
pub struct FileSystemData(#[qjs(skip_trace)] pub Arc<dyn FileSystem>);

/// The file system `fs` writes go to: the build's `output_fs`. Stored for the duration of each
/// plugin call, since a runtime is shared by every build that reads through the same file system.
/// Writes fail when it isn't set, e.g. outside a plugin call.
#[derive(JsLifetime, Trace, Clone)]
pub struct OutputFileSystemData(#[qjs(skip_trace)] pub Arc<dyn FileSystem>);

fn resolve_fs_path(ctx: &Ctx<'_>, path: &str) -> rquickjs::Result<PathId> {
  let path = Path::new(path);
  if path.is_absolute() {
    return Ok(PathId::new(path));
  }
  let process: rquickjs::Object = ctx.globals().get("process")?;
  let cwd: Function = process.get("cwd")?;
  let cwd: String = cwd.call((rquickjs::function::This(process),))?;
  Ok(PathId::new(&Path::new(&cwd).join(path)))
}

#[derive(JsLifetime, Trace, Clone)]
#[rquickjs::class]
pub struct Fs {}

const FS_EXPORTS: &[&str] = &[
  "Stats",
  "promises",
  "existsSync",
  "readFileSync",
  "readFile",
  "statSync",
  "lstatSync",
  "stat",
  "lstat",
  "realpath",
  "realpathSync",
  "readlink",
  "readlinkSync",
  "readdirSync",
  "readdir",
  "globSync",
  "glob",
  "writeFileSync",
  "writeFile",
  "copyFileSync",
  "copyFile",
  "unlinkSync",
  "unlink",
  "mkdirSync",
  "mkdir",
  "rmdirSync",
  "rmdir",
  "rmSync",
  "rm",
  "constants",
];

const FS_PROMISES_EXPORTS: &[&str] = &[
  "Stats",
  "readFile",
  "stat",
  "lstat",
  "realpath",
  "readlink",
  "readdir",
  "glob",
  "writeFile",
  "copyFile",
  "unlink",
  "mkdir",
  "rmdir",
  "rm",
  "constants",
];

fn declare_exports(
  decl: &rquickjs::module::Declarations<'_>,
  names: &[&str],
) -> rquickjs::Result<()> {
  decl.declare("default")?;
  for name in names {
    decl.declare(*name)?;
  }
  Ok(())
}

/// Exports the module object as the default export, and its members as named exports.
fn export_members<'js>(
  ctx: &Ctx<'js>,
  exports: &rquickjs::module::Exports<'js>,
  module: impl IntoJs<'js>,
  names: &[&str],
) -> rquickjs::Result<()> {
  let module = module.into_js(ctx)?;
  let object = module.as_object().unwrap();
  for name in names {
    exports.export(*name, object.get::<_, Value>(*name)?)?;
  }
  exports.export("default", module)?;
  Ok(())
}

impl ModuleDef for Fs {
  fn declare<'js>(decl: &rquickjs::module::Declarations<'js>) -> rquickjs::Result<()> {
    declare_exports(decl, FS_EXPORTS)
  }

  fn evaluate<'js>(
    ctx: &rquickjs::Ctx<'js>,
    exports: &rquickjs::module::Exports<'js>,
  ) -> rquickjs::Result<()> {
    export_members(ctx, exports, Fs {}, FS_EXPORTS)
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
        let contents = fs.read(resolve_fs_path(&ctx, &path)?);
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
        let contents = fs.read_to_string(resolve_fs_path(&ctx, &path)?);
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
    let stat = fs.stat(resolve_fs_path(&ctx, &path)?);
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
    let stat = fs.lstat(resolve_fs_path(&ctx, &path)?);
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
    let entries = fs.read_dir(resolve_fs_path(&ctx, &path)?);
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
      Err(err) => Ok(Err(io_exception(ctx, &err, "scandir", &path)?)),
    }
  }

  fn realpath_internal<'js>(
    ctx: Ctx<'js>,
    path: String,
  ) -> rquickjs::Result<Result<String, Exception<'js>>> {
    let fs = ctx.userdata::<FileSystemData>().unwrap().0.clone();
    match fs.canonicalize(resolve_fs_path(&ctx, &path)?) {
      Ok(link) => Ok(Ok(link.to_path_buf().to_string_lossy().into_owned())),
      Err(e) => Ok(Err(io_exception(ctx, &e, "realpath", &path)?)),
    }
  }

  fn readlink_internal<'js>(
    ctx: Ctx<'js>,
    path: String,
  ) -> rquickjs::Result<Result<String, Exception<'js>>> {
    let fs = ctx.userdata::<FileSystemData>().unwrap().0.clone();
    match fs.read_link(resolve_fs_path(&ctx, &path)?) {
      Ok(link) => Ok(Ok(link.to_path_buf().to_string_lossy().into_owned())),
      Err(e) => Ok(Err(io_exception(ctx, &e, "readlink", &path)?)),
    }
  }

  fn glob_internal<'js>(
    ctx: Ctx<'js>,
    glob: String,
    options: Option<&Value>,
  ) -> rquickjs::Result<Result<Vec<String>, Exception<'js>>> {
    let fs = ctx.userdata::<FileSystemData>().unwrap().0.clone();
    let mut cwd = std::env::current_dir().unwrap();
    if let Some(options) = options {
      if let Some(obj) = options.as_object() {
        cwd = obj
          .get::<_, Value>("cwd")
          .ok()
          .and_then(|v| v.as_string().and_then(|s| s.to_string().ok()))
          .map(|s| s.into())
          .unwrap_or_default();
      }
    };

    let cwd = PathId::new(&cwd);
    let entries = fs.glob(&glob, cwd);
    Ok(Ok(
      entries
        .into_iter()
        .map(|e| e.relative(&cwd).to_string_lossy().into_owned())
        .collect(),
    ))
  }
}

/// The `encoding` and `flag` of `writeFile`'s options, given as an encoding string or an object.
fn write_options<'js>(
  ctx: &Ctx<'js>,
  options: Option<&Value<'js>>,
) -> rquickjs::Result<Option<String>> {
  let Some(options) = options.filter(|o| !o.is_undefined() && !o.is_null()) else {
    return Ok(None);
  };
  if let Some(encoding) = options.as_string() {
    return Ok(Some(encoding.to_string()?));
  }
  let Some(object) = options.as_object() else {
    return Err(Exception::throw_type(
      ctx,
      "options must be a string or an object",
    ));
  };
  if let Some(flag) = object.get::<_, Option<String>>("flag")? {
    if flag != "w" {
      return Err(Exception::throw_type(
        ctx,
        &format!("Unsupported flag: {flag}"),
      ));
    }
  }
  object.get::<_, Option<String>>("encoding")
}

impl Fs {
  fn write_file_internal<'js>(
    ctx: Ctx<'js>,
    path: String,
    data: Value<'js>,
    options: Option<&Value<'js>>,
  ) -> rquickjs::Result<Result<(), Exception<'js>>> {
    let encoding = write_options(&ctx, options)?;
    let bytes = crate::crypto::value_to_bytes(&ctx, &data, encoding.as_deref())?;
    let fs = match output_fs(&ctx, "open", &path)? {
      Ok(fs) => fs,
      Err(exception) => return Ok(Err(exception)),
    };
    match fs.write(resolve_fs_path(&ctx, &path)?, &bytes) {
      Ok(()) => Ok(Ok(())),
      Err(err) => Ok(Err(io_exception(ctx, &err, "open", &path)?)),
    }
  }

  fn copy_file_internal<'js>(
    ctx: Ctx<'js>,
    src: String,
    dest: String,
    mode: Option<&Value<'js>>,
  ) -> rquickjs::Result<Result<(), Exception<'js>>> {
    let mode = match mode.filter(|m| !m.is_undefined()) {
      Some(mode) => mode
        .as_number()
        .ok_or_else(|| Exception::throw_type(&ctx, "mode must be a number"))?
        as u32,
      None => 0,
    };
    let fs = match output_fs(&ctx, "copyfile", &src)? {
      Ok(fs) => fs,
      Err(exception) => return Ok(Err(exception)),
    };
    let from = resolve_fs_path(&ctx, &src)?;
    let to = resolve_fs_path(&ctx, &dest)?;
    let result = if mode & COPYFILE_EXCL != 0 && fs.lstat(to).is_some() {
      Err(std::io::Error::from(std::io::ErrorKind::AlreadyExists))
    } else {
      fs.copy(from, to)
    };
    match result {
      Ok(()) => Ok(Ok(())),
      Err(err) => {
        let exception = io_exception(ctx, &err, "copyfile", &src)?;
        exception.set("dest", dest)?;
        Ok(Err(exception))
      }
    }
  }

  fn unlink_internal<'js>(
    ctx: Ctx<'js>,
    path: String,
  ) -> rquickjs::Result<Result<(), Exception<'js>>> {
    let fs = match output_fs(&ctx, "unlink", &path)? {
      Ok(fs) => fs,
      Err(exception) => return Ok(Err(exception)),
    };
    match fs.remove_file(resolve_fs_path(&ctx, &path)?) {
      Ok(()) => Ok(Ok(())),
      Err(err) => Ok(Err(io_exception(ctx, &err, "unlink", &path)?)),
    }
  }

  /// Returns the first directory created when `recursive` is set, as Node does.
  fn mkdir_internal<'js>(
    ctx: Ctx<'js>,
    path: String,
    options: Option<&Value<'js>>,
  ) -> rquickjs::Result<Result<Option<String>, Exception<'js>>> {
    // `mode` (given alone as a number, or in the object) is ignored.
    let recursive = bool_option(&ctx, options, "recursive")?;
    let fs = match output_fs(&ctx, "mkdir", &path)? {
      Ok(fs) => fs,
      Err(exception) => return Ok(Err(exception)),
    };
    let resolved = resolve_fs_path(&ctx, &path)?;
    let result = if recursive {
      let first_created = resolved
        .ancestors()
        .take_while(|ancestor| fs.kind(*ancestor).is_empty())
        .last();
      fs.create_dir_all(resolved)
        .map(|()| first_created.map(|dir| dir.to_path_buf().to_string_lossy().into_owned()))
    } else {
      fs.create_dir(resolved).map(|()| None)
    };
    match result {
      Ok(created) => Ok(Ok(created)),
      Err(err) => Ok(Err(io_exception(ctx, &err, "mkdir", &path)?)),
    }
  }

  fn rmdir_internal<'js>(
    ctx: Ctx<'js>,
    path: String,
    options: Option<&Value<'js>>,
  ) -> rquickjs::Result<Result<(), Exception<'js>>> {
    // Deprecated in Node in favor of `rm`, but still supported.
    let recursive = bool_option(&ctx, options, "recursive")?;
    let fs = match output_fs(&ctx, "rmdir", &path)? {
      Ok(fs) => fs,
      Err(exception) => return Ok(Err(exception)),
    };
    let resolved = resolve_fs_path(&ctx, &path)?;
    let result = if recursive {
      fs.remove_dir_all(resolved)
    } else {
      fs.remove_dir(resolved)
    };
    match result {
      Ok(()) => Ok(Ok(())),
      Err(err) => Ok(Err(io_exception(ctx, &err, "rmdir", &path)?)),
    }
  }

  fn rm_internal<'js>(
    ctx: Ctx<'js>,
    path: String,
    options: Option<&Value<'js>>,
  ) -> rquickjs::Result<Result<(), Exception<'js>>> {
    let recursive = bool_option(&ctx, options, "recursive")?;
    let force = bool_option(&ctx, options, "force")?;
    let fs = match output_fs(&ctx, "rm", &path)? {
      Ok(fs) => fs,
      Err(exception) => return Ok(Err(exception)),
    };
    let resolved = resolve_fs_path(&ctx, &path)?;
    let result = match fs.lstat(resolved) {
      None => Err(std::io::Error::from(std::io::ErrorKind::NotFound)),
      Some(stat) if stat.kind.contains(FileKind::IS_DIR) => {
        if !recursive {
          let exception = Exception::from_message(
            ctx,
            &format!("Path is a directory: rm returned EISDIR (is a directory) {path}"),
          )?;
          exception.set("code", "ERR_FS_EISDIR")?;
          exception.set("errno", 21)?;
          exception.set("syscall", "rm")?;
          exception.set("path", path)?;
          return Ok(Err(exception));
        }
        fs.remove_dir_all(resolved)
      }
      Some(_) => fs.remove_file(resolved),
    };
    match result {
      Ok(()) => Ok(Ok(())),
      Err(err) if force && err.kind() == std::io::ErrorKind::NotFound => Ok(Ok(())),
      Err(err) => Ok(Err(io_exception(ctx, &err, "rm", &path)?)),
    }
  }
}

/// A boolean property of an options object, defaulting to false. Other kinds of options, e.g. a
/// `mode` number, have none.
fn bool_option<'js>(
  ctx: &Ctx<'js>,
  options: Option<&Value<'js>>,
  name: &str,
) -> rquickjs::Result<bool> {
  let Some(object) = options.and_then(|options| options.as_object()) else {
    return Ok(false);
  };
  match object.get::<_, Value>(name)? {
    value if value.is_undefined() => Ok(false),
    value => value.as_bool().ok_or_else(|| {
      Exception::throw_type(
        ctx,
        &format!("The \"options.{name}\" property must be a boolean"),
      )
    }),
  }
}

/// `fs.constants.COPYFILE_EXCL`: fail if the destination exists.
const COPYFILE_EXCL: u32 = 1;

/// The file system writes go to, or an `EROFS` error when there is none.
fn output_fs<'js>(
  ctx: &Ctx<'js>,
  syscall: &str,
  path: &str,
) -> rquickjs::Result<Result<Arc<dyn FileSystem>, Exception<'js>>> {
  if let Some(fs) = ctx.userdata::<OutputFileSystemData>() {
    return Ok(Ok(fs.0.clone()));
  }
  let exception = Exception::from_message(
    ctx.clone(),
    &format!("EROFS: read-only file system, {syscall} '{path}'"),
  )?;
  exception.set("code", "EROFS")?;
  exception.set("syscall", syscall)?;
  exception.set("path", path)?;
  Ok(Err(exception))
}

/// Calls a Node-style callback with only an error argument, e.g. `writeFile`'s.
fn handle_async_void<'js>(
  callback: &Function<'js>,
  result: Result<(), Exception<'js>>,
) -> rquickjs::Result<()> {
  match result {
    Ok(()) => callback.call((rquickjs::Null,)),
    Err(exception) => callback.call((exception,)),
  }
}

/// Splits a Node-style `(...optional, callback)` argument list.
fn split_callback<'a, 'js>(
  ctx: &Ctx<'js>,
  rest: &'a [Value<'js>],
) -> rquickjs::Result<(Option<&'a Value<'js>>, &'a Function<'js>)> {
  let (option, callback) = if rest.len() >= 2 {
    (Some(&rest[0]), rest[1].as_function())
  } else {
    (None, rest.first().and_then(|v| v.as_function()))
  };
  match callback {
    Some(callback) => Ok((option, callback)),
    None => Err(Exception::throw_message(
      ctx,
      "Required callback not provided",
    )),
  }
}

/// Like `to_promise`, but rejects with an exception `result` threw (e.g. for an invalid
/// argument), as Node's promise API does, rather than throwing it.
fn try_to_promise<'js, V: IntoJs<'js>>(
  ctx: &Ctx<'js>,
  result: rquickjs::Result<Result<V, Exception<'js>>>,
) -> rquickjs::Result<Promise<'js>> {
  match result {
    Ok(result) => to_promise(ctx, result),
    Err(rquickjs::Error::Exception) => {
      let error = ctx.catch();
      let (promise, _, reject) = Promise::new(ctx)?;
      reject.call::<_, Value>((error,))?;
      Ok(promise)
    }
    Err(err) => Err(err),
  }
}

/// `fs.constants`, with the flags these functions understand.
fn constants<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<rquickjs::Object<'js>> {
  let constants = rquickjs::Object::new(ctx.clone())?;
  constants.set("F_OK", 0)?;
  constants.set("R_OK", 4)?;
  constants.set("W_OK", 2)?;
  constants.set("X_OK", 1)?;
  constants.set("COPYFILE_EXCL", COPYFILE_EXCL)?;
  constants.set("COPYFILE_FICLONE", 2)?;
  constants.set("COPYFILE_FICLONE_FORCE", 4)?;
  Ok(constants)
}

/// Creates a Node-style error with a `code` property, which callers like glob
/// inspect to distinguish expected failures (e.g. ENOENT) from real ones.
fn io_exception<'js>(
  ctx: Ctx<'js>,
  err: &std::io::Error,
  syscall: &str,
  path: &str,
) -> rquickjs::Result<Exception<'js>> {
  use std::io::ErrorKind;
  let code = match err.kind() {
    ErrorKind::NotFound => Some("ENOENT"),
    ErrorKind::NotADirectory => Some("ENOTDIR"),
    ErrorKind::IsADirectory => Some("EISDIR"),
    ErrorKind::PermissionDenied => Some("EACCES"),
    ErrorKind::InvalidInput => Some("EINVAL"),
    ErrorKind::AlreadyExists => Some("EEXIST"),
    ErrorKind::DirectoryNotEmpty => Some("ENOTEMPTY"),
    _ => None,
  };
  let Some(code) = code else {
    return Exception::from_message(ctx, &err.to_string());
  };
  let exception = Exception::from_message(ctx, &format!("{code}: {err}, {syscall} '{path}'"))?;
  exception.set("code", code)?;
  exception.set("syscall", syscall)?;
  exception.set("path", path)?;
  Ok(exception)
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

  pub fn exists_sync<'js>(ctx: Ctx<'js>, path: String) -> bool {
    let fs = ctx.userdata::<FileSystemData>().unwrap().0.clone();
    resolve_fs_path(&ctx, &path)
      .ok()
      .and_then(|path| fs.stat(path))
      .is_some()
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

  pub fn glob_sync<'js>(
    ctx: Ctx<'js>,
    glob: String,
    options: rquickjs::function::Opt<Value<'js>>,
  ) -> rquickjs::Result<Value<'js>> {
    handle_sync(
      &ctx,
      Fs::glob_internal(ctx.clone(), glob, options.0.as_ref())?,
    )
  }

  pub fn glob<'js>(
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

    handle_async(&callback, Fs::glob_internal(ctx.clone(), path, options)?)
  }

  pub fn write_file_sync<'js>(
    ctx: Ctx<'js>,
    path: String,
    data: Value<'js>,
    options: rquickjs::function::Opt<Value<'js>>,
  ) -> rquickjs::Result<()> {
    handle_sync(
      &ctx,
      Fs::write_file_internal(ctx.clone(), path, data, options.0.as_ref())?,
    )?;
    Ok(())
  }

  pub fn write_file<'js>(
    ctx: Ctx<'js>,
    path: String,
    data: Value<'js>,
    rest: rquickjs::function::Rest<Value<'js>>,
  ) -> rquickjs::Result<()> {
    let (options, callback) = split_callback(&ctx, &rest.0)?;
    handle_async_void(
      callback,
      Fs::write_file_internal(ctx.clone(), path, data, options)?,
    )
  }

  pub fn copy_file_sync<'js>(
    ctx: Ctx<'js>,
    src: String,
    dest: String,
    mode: rquickjs::function::Opt<Value<'js>>,
  ) -> rquickjs::Result<()> {
    handle_sync(
      &ctx,
      Fs::copy_file_internal(ctx.clone(), src, dest, mode.0.as_ref())?,
    )?;
    Ok(())
  }

  pub fn copy_file<'js>(
    ctx: Ctx<'js>,
    src: String,
    dest: String,
    rest: rquickjs::function::Rest<Value<'js>>,
  ) -> rquickjs::Result<()> {
    let (mode, callback) = split_callback(&ctx, &rest.0)?;
    handle_async_void(
      callback,
      Fs::copy_file_internal(ctx.clone(), src, dest, mode)?,
    )
  }

  pub fn unlink_sync<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<()> {
    handle_sync(&ctx, Fs::unlink_internal(ctx.clone(), path)?)?;
    Ok(())
  }

  pub fn unlink<'js>(ctx: Ctx<'js>, path: String, callback: Function<'js>) -> rquickjs::Result<()> {
    handle_async_void(&callback, Fs::unlink_internal(ctx.clone(), path)?)
  }

  pub fn mkdir_sync<'js>(
    ctx: Ctx<'js>,
    path: String,
    options: rquickjs::function::Opt<Value<'js>>,
  ) -> rquickjs::Result<Value<'js>> {
    handle_sync(
      &ctx,
      Fs::mkdir_internal(ctx.clone(), path, options.0.as_ref())?,
    )
  }

  pub fn mkdir<'js>(
    ctx: Ctx<'js>,
    path: String,
    rest: rquickjs::function::Rest<Value<'js>>,
  ) -> rquickjs::Result<()> {
    let (options, callback) = split_callback(&ctx, &rest.0)?;
    handle_async(callback, Fs::mkdir_internal(ctx.clone(), path, options)?)
  }

  pub fn rmdir_sync<'js>(
    ctx: Ctx<'js>,
    path: String,
    options: rquickjs::function::Opt<Value<'js>>,
  ) -> rquickjs::Result<()> {
    handle_sync(
      &ctx,
      Fs::rmdir_internal(ctx.clone(), path, options.0.as_ref())?,
    )?;
    Ok(())
  }

  pub fn rmdir<'js>(
    ctx: Ctx<'js>,
    path: String,
    rest: rquickjs::function::Rest<Value<'js>>,
  ) -> rquickjs::Result<()> {
    let (options, callback) = split_callback(&ctx, &rest.0)?;
    handle_async_void(callback, Fs::rmdir_internal(ctx.clone(), path, options)?)
  }

  pub fn rm_sync<'js>(
    ctx: Ctx<'js>,
    path: String,
    options: rquickjs::function::Opt<Value<'js>>,
  ) -> rquickjs::Result<()> {
    handle_sync(
      &ctx,
      Fs::rm_internal(ctx.clone(), path, options.0.as_ref())?,
    )?;
    Ok(())
  }

  pub fn rm<'js>(
    ctx: Ctx<'js>,
    path: String,
    rest: rquickjs::function::Rest<Value<'js>>,
  ) -> rquickjs::Result<()> {
    let (options, callback) = split_callback(&ctx, &rest.0)?;
    handle_async_void(callback, Fs::rm_internal(ctx.clone(), path, options)?)
  }

  #[qjs(get)]
  fn constants<'js>(ctx: Ctx<'js>) -> rquickjs::Result<rquickjs::Object<'js>> {
    constants(&ctx)
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

  pub fn glob<'js>(
    ctx: Ctx<'js>,
    glob: String,
    options: rquickjs::function::Opt<Value<'js>>,
  ) -> rquickjs::Result<Promise<'js>> {
    to_promise(
      &ctx,
      Fs::glob_internal(ctx.clone(), glob, options.0.as_ref())?,
    )
  }

  pub fn write_file<'js>(
    ctx: Ctx<'js>,
    path: String,
    data: Value<'js>,
    options: rquickjs::function::Opt<Value<'js>>,
  ) -> rquickjs::Result<Promise<'js>> {
    try_to_promise(
      &ctx,
      Fs::write_file_internal(ctx.clone(), path, data, options.0.as_ref()),
    )
  }

  pub fn copy_file<'js>(
    ctx: Ctx<'js>,
    src: String,
    dest: String,
    mode: rquickjs::function::Opt<Value<'js>>,
  ) -> rquickjs::Result<Promise<'js>> {
    try_to_promise(
      &ctx,
      Fs::copy_file_internal(ctx.clone(), src, dest, mode.0.as_ref()),
    )
  }

  pub fn unlink<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<Promise<'js>> {
    try_to_promise(&ctx, Fs::unlink_internal(ctx.clone(), path))
  }

  pub fn mkdir<'js>(
    ctx: Ctx<'js>,
    path: String,
    options: rquickjs::function::Opt<Value<'js>>,
  ) -> rquickjs::Result<Promise<'js>> {
    try_to_promise(
      &ctx,
      Fs::mkdir_internal(ctx.clone(), path, options.0.as_ref()),
    )
  }

  pub fn rmdir<'js>(
    ctx: Ctx<'js>,
    path: String,
    options: rquickjs::function::Opt<Value<'js>>,
  ) -> rquickjs::Result<Promise<'js>> {
    try_to_promise(
      &ctx,
      Fs::rmdir_internal(ctx.clone(), path, options.0.as_ref()),
    )
  }

  pub fn rm<'js>(
    ctx: Ctx<'js>,
    path: String,
    options: rquickjs::function::Opt<Value<'js>>,
  ) -> rquickjs::Result<Promise<'js>> {
    try_to_promise(&ctx, Fs::rm_internal(ctx.clone(), path, options.0.as_ref()))
  }

  #[qjs(get)]
  fn constants<'js>(ctx: Ctx<'js>) -> rquickjs::Result<rquickjs::Object<'js>> {
    constants(&ctx)
  }

  pub fn open<'js>(_ctx: Ctx<'js>, path: String, _rest: rquickjs::function::Rest<Value<'js>>) {
    println!("Open {}", path);
  }

  pub fn close() {}
}

impl ModuleDef for FsPromises {
  fn declare<'js>(decl: &rquickjs::module::Declarations<'js>) -> rquickjs::Result<()> {
    declare_exports(decl, FS_PROMISES_EXPORTS)
  }

  fn evaluate<'js>(
    ctx: &rquickjs::Ctx<'js>,
    exports: &rquickjs::module::Exports<'js>,
  ) -> rquickjs::Result<()> {
    export_members(ctx, exports, FsPromises {}, FS_PROMISES_EXPORTS)
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
