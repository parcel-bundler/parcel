use rquickjs::{Ctx, Value};

#[rquickjs::function]
pub fn structured_clone<'js>(ctx: Ctx<'js>, value: Value<'js>) -> rquickjs::Result<Value<'js>> {
  unsafe {
    use rquickjs_sys::*;

    // Use quickjs's ability to serialize and deserialize objects to bytecode to implement cloning.
    let ctx_ptr = ctx.as_raw().as_ptr();
    let mut size = 0;
    let buf = JS_WriteObject(
      ctx_ptr,
      &mut size,
      value.as_raw(),
      (JS_WRITE_OBJ_BYTECODE
        | JS_WRITE_OBJ_REFERENCE
        | JS_WRITE_OBJ_SAB
        | JS_WRITE_OBJ_STRIP_SOURCE) as i32,
    );
    if buf.is_null() {
      return Err(rquickjs::Exception::throw_type(
        &ctx,
        &format!("Value could not be cloned."),
      ));
    }

    let value = JS_ReadObject(
      ctx_ptr,
      buf,
      size,
      (JS_READ_OBJ_BYTECODE | JS_READ_OBJ_REFERENCE | JS_READ_OBJ_SAB) as i32,
    );

    js_free(ctx_ptr, buf as _);

    return Ok(Value::from_raw(ctx, value));
  }
}
