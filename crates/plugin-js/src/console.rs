use std::{cell::RefCell, rc::Rc};

use parcel_core::LogLevel;
use rquickjs::{
  Ctx, Function, IntoJs, JsLifetime, Object, Value, class::Trace, function::This,
  module::ModuleDef, prelude::Rest,
};

use crate::cjs::require;

#[derive(JsLifetime, Trace)]
pub(crate) struct ConsoleLogs(#[qjs(skip_trace)] pub Rc<RefCell<Vec<(LogLevel, String)>>>);

#[derive(Clone, Trace, JsLifetime)]
#[rquickjs::class(frozen)]
pub struct Console {}

impl Console {
  const METHODS: [&'static str; 5] = ["log", "info", "debug", "warn", "error"];

  pub fn create<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Object<'js>> {
    let instance = (Console {}).into_js(ctx)?.into_object().unwrap();
    let console = Object::new(ctx.clone())?;
    // Node's console methods can be destructured or imported as named exports.
    for name in Self::METHODS {
      let method: Function = instance.get(name)?;
      let bind: Function = method.get("bind")?;
      let bound: Function = bind.call((This(method), instance.clone()))?;
      console.set(name, bound)?;
    }
    Ok(console)
  }

  fn print<'js>(
    &self,
    ctx: Ctx<'js>,
    level: LogLevel,
    values: Rest<Value<'js>>,
  ) -> rquickjs::Result<()> {
    use std::fmt::Write;

    let message = if values.len() == 1 && values[0].is_string() {
      values[0].as_string().unwrap().to_string()?
    } else {
      let util = require(ctx.clone(), "util".into())?;
      let util = util.try_into_object().unwrap();
      let inspect: rquickjs::Function = util.get("inspect")?;
      let mut message = String::new();
      for (i, value) in values.0.into_iter().enumerate() {
        if i > 0 {
          write!(&mut message, ", ").map_err(|_| rquickjs::Error::Unknown)?
        }
        let formatted: String = inspect.call((value,))?;
        message.push_str(&formatted);
      }
      message
    };
    if let Some(logs) = ctx.userdata::<ConsoleLogs>() {
      logs.0.borrow_mut().push((level, message));
    }
    Ok(())
  }
}

#[rquickjs::methods]
impl Console {
  fn debug<'js>(&self, ctx: Ctx<'js>, values: Rest<Value<'js>>) -> rquickjs::Result<()> {
    self.print(ctx, LogLevel::Verbose, values)
  }

  fn info<'js>(&self, ctx: Ctx<'js>, values: Rest<Value<'js>>) -> rquickjs::Result<()> {
    self.print(ctx, LogLevel::Info, values)
  }

  fn log<'js>(&self, ctx: Ctx<'js>, values: Rest<Value<'js>>) -> rquickjs::Result<()> {
    self.print(ctx, LogLevel::Info, values)
  }

  fn warn<'js>(&self, ctx: Ctx<'js>, values: Rest<Value<'js>>) -> rquickjs::Result<()> {
    self.print(ctx, LogLevel::Warn, values)
  }

  fn error<'js>(&self, ctx: Ctx<'js>, values: Rest<Value<'js>>) -> rquickjs::Result<()> {
    self.print(ctx, LogLevel::Error, values)
  }
}

impl ModuleDef for Console {
  fn declare<'js>(decl: &rquickjs::module::Declarations<'js>) -> rquickjs::Result<()> {
    decl.declare("default")?;
    for name in Self::METHODS {
      decl.declare(name)?;
    }
    Ok(())
  }

  fn evaluate<'js>(
    ctx: &Ctx<'js>,
    exports: &rquickjs::module::Exports<'js>,
  ) -> rquickjs::Result<()> {
    let console: Object = ctx.globals().get("console")?;
    for name in Self::METHODS {
      let val: Value = console.get(name)?;
      exports.export(name, val)?;
    }
    exports.export("default", console)?;
    Ok(())
  }
}
