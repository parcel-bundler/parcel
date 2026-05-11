use std::collections::HashMap;

use rquickjs::{
  Ctx, JsLifetime, Object, Value,
  class::Trace,
  function::{Args, Rest},
  methods,
  module::ModuleDef,
};

#[derive(Clone, Trace, JsLifetime)]
#[rquickjs::class(frozen)]
pub struct Process<'js> {
  #[qjs(get)]
  env: Object<'js>,
}

impl<'js> Process<'js> {
  pub fn new(ctx: Ctx<'js>, env: &HashMap<String, String>) -> rquickjs::Result<Process<'js>> {
    let obj = Object::new(ctx)?;
    for (k, v) in env {
      obj.set(k, v)?;
    }
    Ok(Process { env: obj })
  }
}

#[methods(rename_all = "camelCase")]
impl<'js> Process<'js> {
  #[qjs(get)]
  fn versions(ctx: Ctx<'js>) -> rquickjs::Result<Object<'js>> {
    let obj = Object::new(ctx)?;
    obj.set("node", "24.0.0")?;
    Ok(obj)
  }

  #[qjs(get)]
  fn version() -> &'static str {
    "v24.0.0"
  }

  #[qjs(get)]
  fn browser() -> bool {
    true
  }

  #[qjs(get)]
  fn platform() -> &'static str {
    "parcel"
  }

  #[qjs(get)]
  fn title() -> &'static str {
    "parcel"
  }

  #[qjs(get)]
  fn argv() -> Vec<()> {
    vec![]
  }

  fn cwd() -> String {
    std::env::current_dir()
      .unwrap()
      .to_str()
      .unwrap()
      .to_owned()
  }

  fn next_tick(
    ctx: Ctx<'js>,
    func: rquickjs::Function<'js>,
    args: Rest<Value<'js>>,
  ) -> rquickjs::Result<()> {
    let mut js_args = Args::new(ctx, args.len());
    for arg in args.0 {
      js_args.push_arg(arg)?;
    }
    func.call_arg(js_args)
  }
}

impl<'a> ModuleDef for Process<'a> {
  fn declare<'js>(decl: &rquickjs::module::Declarations<'js>) -> rquickjs::Result<()> {
    decl.declare("env")?;
    decl.declare("versions")?;
    decl.declare("version")?;
    decl.declare("browser")?;
    decl.declare("platform")?;
    decl.declare("title")?;
    decl.declare("argv")?;
    decl.declare("cwd")?;
    decl.declare("nextTick")?;
    Ok(())
  }

  fn evaluate<'js>(
    ctx: &Ctx<'js>,
    exports: &rquickjs::module::Exports<'js>,
  ) -> rquickjs::Result<()> {
    let process: Object = ctx.globals().get("process")?;
    for key in process.keys() {
      let key: String = key?;
      let val: Value = process.get(&key)?;
      exports.export(key, val)?;
    }
    Ok(())
  }
}
