extern crate napi;
#[macro_use]
extern crate napi_derive;
extern crate xxhash_rust;

use napi::{CallContext, Env, JsBuffer, JsObject, JsString, JsUndefined, Property, Result};
use std::hash::Hasher;
use xxhash_rust::xxh3::{xxh3_64, Xxh3};

#[js_function(1)]
fn hash_string(ctx: CallContext) -> Result<JsString> {
  let s = ctx.get::<JsString>(0)?.into_utf8()?;
  let s = s.as_slice();
  let res = xxh3_64(s);
  let res_str = format!("{:016x}", res);
  ctx.env.create_string_from_std(res_str)
}

#[js_function(1)]
fn hash_buffer(ctx: CallContext) -> Result<JsString> {
  let s = ctx.get::<JsBuffer>(0)?.into_value()?;
  let s = s.as_ref();
  let res = xxh3_64(s);
  let res_str = format!("{:016x}", res);
  ctx.env.create_string_from_std(res_str)
}

#[js_function(1)]
fn constructor(ctx: CallContext) -> Result<JsUndefined> {
  let mut this: JsObject = ctx.this_unchecked();
  let h = Xxh3::new();
  ctx.env.wrap(&mut this, h)?;
  ctx.env.get_undefined()
}

#[js_function(1)]
fn write_string(ctx: CallContext) -> Result<JsUndefined> {
  let this: JsObject = ctx.this_unchecked();
  let h: &mut Xxh3 = ctx.env.unwrap(&this)?;
  let s = ctx.get::<JsString>(0)?.into_utf8()?;
  let s = s.as_slice();
  h.write(s);
  ctx.env.get_undefined()
}

#[js_function(1)]
fn write_buffer(ctx: CallContext) -> Result<JsUndefined> {
  let this: JsObject = ctx.this_unchecked();
  let h: &mut Xxh3 = ctx.env.unwrap(&this)?;
  let s = ctx.get::<JsBuffer>(0)?.into_value()?;
  let s = s.as_ref();
  h.write(s);
  ctx.env.get_undefined()
}

#[js_function(1)]
fn finish(ctx: CallContext) -> Result<JsString> {
  let this: JsObject = ctx.this_unchecked();
  let h: &mut Xxh3 = ctx.env.unwrap(&this)?;
  let res = h.finish();
  let res_str = format!("{:016x}", res);
  ctx.env.create_string_from_std(res_str)
}

#[module_exports]
fn init(mut exports: JsObject, env: Env) -> Result<()> {
  exports.create_named_method("hashString", hash_string)?;
  exports.create_named_method("hashBuffer", hash_buffer)?;

  let write_string_method = Property::new("writeString")?.with_method(write_string);
  let write_buffer_method = Property::new("writeBuffer")?.with_method(write_buffer);
  let finish_method = Property::new("finish")?.with_method(finish);
  let hash_class = env.define_class(
    "Hash",
    constructor,
    &[write_string_method, write_buffer_method, finish_method],
  )?;

  exports.set_named_property("Hash", hash_class)?;
  Ok(())
}
