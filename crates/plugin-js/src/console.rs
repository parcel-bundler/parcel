use rquickjs::{Ctx, JsLifetime, Value, class::Trace, prelude::Rest};
use rquickjs_extra_console::Formatter;

use crate::cjs::require;

#[derive(Clone, Trace, JsLifetime)]
#[rquickjs::class(frozen)]
pub struct Console {
  formatter: Formatter,
}

impl Console {
  pub fn new(formatter: Formatter) -> Self {
    Self { formatter }
  }

  fn print<'js>(&self, ctx: Ctx<'js>, values: Rest<Value<'js>>) -> rquickjs::Result<()> {
    use std::fmt::Write;

    let util = require(ctx, "util".into())?;
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
    // log::log!(target: &self.target, level, "{message}");
    println!("{}", message);
    Ok(())
  }
}

#[rquickjs::methods]
impl Console {
  // fn debug(&self, values: Rest<Value<'_>>) -> rquickjs::Result<()> {
  //   self.print(log::Level::Debug, values)
  // }

  fn log<'js>(&self, ctx: Ctx<'js>, values: Rest<Value<'js>>) -> rquickjs::Result<()> {
    self.print(ctx, values)
  }

  fn warn<'js>(&self, ctx: Ctx<'js>, values: Rest<Value<'js>>) -> rquickjs::Result<()> {
    self.print(ctx, values)
  }

  fn error<'js>(&self, ctx: Ctx<'js>, values: Rest<Value<'js>>) -> rquickjs::Result<()> {
    self.print(ctx, values)
  }
}
