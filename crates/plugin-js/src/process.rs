use rquickjs::{
  Ctx, JsLifetime, Object, Value,
  class::Trace,
  function::{Args, Rest},
  methods,
};

#[derive(Clone, Trace, JsLifetime)]
#[rquickjs::class(frozen)]
pub struct Process {}

#[methods(rename_all = "camelCase")]
impl Process {
  #[qjs(get)]
  fn env<'js>(ctx: Ctx<'js>) -> rquickjs::Result<Object<'js>> {
    Object::new(ctx)
  }

  #[qjs(get)]
  fn versions<'js>(ctx: Ctx<'js>) -> rquickjs::Result<Object<'js>> {
    let obj = Object::new(ctx)?;
    obj.set("node", "24.0.0")?;
    Ok(obj)
  }

  #[qjs(get)]
  fn version<'js>() -> &'static str {
    "v24.0.0"
  }

  #[qjs(get)]
  fn browser() -> bool {
    true
  }

  #[qjs(get)]
  fn platform() -> String {
    "parcel".into()
  }

  fn cwd() -> String {
    std::env::current_dir()
      .unwrap()
      .to_str()
      .unwrap()
      .to_owned()
  }

  fn next_tick<'js>(
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
