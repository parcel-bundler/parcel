use rquickjs::{Ctx, JsLifetime, Object, class::Trace, methods};

#[derive(Clone, Trace, JsLifetime)]
#[rquickjs::class(frozen)]
pub struct Process {}

#[methods]
impl Process {
  #[qjs(get)]
  fn env<'js>(&self, ctx: Ctx<'js>) -> rquickjs::Result<Object<'js>> {
    Object::new(ctx)
  }

  #[qjs(get)]
  fn browser(&self) -> bool {
    true
  }

  fn cwd(&self) -> String {
    std::env::current_dir()
      .unwrap()
      .to_str()
      .unwrap()
      .to_owned()
  }
}
