extern crate napi;
#[macro_use]
extern crate napi_derive;

use napi::{CallContext, Either, JsNull, JsNumber, JsObject, JsString, Result};
use std::convert::TryInto;
use std::path::Path;

#[js_function(3)]
fn find_ancestor_file(ctx: CallContext) -> Result<Either<JsNull, JsString>> {
  let names = ctx.get::<JsObject>(0)?;
  let length: u32 = names.get_named_property::<JsNumber>("length")?.try_into()?;
  let mut filenames = Vec::new();
  for i in 0..length {
    filenames.push(names.get_element::<JsString>(i)?.into_utf8()?);
  }

  let f = ctx.get::<JsString>(1)?.into_utf8()?;
  let from = Path::new(f.as_str()?);
  let r = ctx.get::<JsString>(2)?.into_utf8()?;
  let root = Path::new(r.as_str()?);

  for dir in from.ancestors() {
    // Break if we hit a node_modules directory
    if let Some(filename) = dir.file_name() {
      if filename == "node_modules" {
        break;
      }
    }

    for name in &filenames {
      let fullpath = dir.join(name.as_str()?);
      if fullpath.is_file() {
        return ctx
          .env
          .create_string(fullpath.to_str().unwrap())
          .map(Either::B);
      }
    }

    if dir == root {
      break;
    }
  }

  ctx.env.get_null().map(Either::A)
}

#[js_function(1)]
fn find_first_file(ctx: CallContext) -> Result<Either<JsNull, JsString>> {
  let names = ctx.get::<JsObject>(0)?;
  let length: u32 = names.get_named_property::<JsNumber>("length")?.try_into()?;
  for i in 0..length {
    let n = names.get_element::<JsString>(i)?.into_utf8()?;
    let path = Path::new(n.as_str()?);

    if path.is_file() {
      return ctx.env.create_string(path.to_str().unwrap()).map(Either::B);
    }
  }

  ctx.env.get_null().map(Either::A)
}

#[js_function(2)]
fn find_node_module(ctx: CallContext) -> Result<Either<JsNull, JsString>> {
  let m = ctx.get::<JsString>(0)?.into_utf8()?;
  let module = Path::new(m.as_str()?);
  let f = ctx.get::<JsString>(1)?.into_utf8()?;
  let from = Path::new(f.as_str()?);

  for dir in from.ancestors() {
    // Skip over node_modules directories
    if let Some(filename) = dir.file_name() {
      if filename == "node_modules" {
        continue;
      }
    }

    let fullpath = dir.join("node_modules").join(module);
    if fullpath.is_dir() {
      return ctx
        .env
        .create_string(fullpath.to_str().unwrap())
        .map(Either::B);
    }
  }

  ctx.env.get_null().map(Either::A)
}

#[module_exports]
fn init(mut exports: JsObject) -> Result<()> {
  exports.create_named_method("findAncestorFile", find_ancestor_file)?;
  exports.create_named_method("findFirstFile", find_first_file)?;
  exports.create_named_method("findNodeModule", find_node_module)?;

  Ok(())
}
