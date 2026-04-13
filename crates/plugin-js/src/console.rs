use rquickjs::{JsLifetime, Value, class::Trace, prelude::Rest};
use rquickjs_extra_console::Formatter;

#[derive(Clone, Trace, JsLifetime)]
#[rquickjs::class(frozen)]
pub struct Console {
  formatter: Formatter,
}

impl Console {
  pub fn new(formatter: Formatter) -> Self {
    Self { formatter }
  }

  fn print(&self, values: Rest<Value<'_>>) -> rquickjs::Result<()> {
    use std::fmt::Write;
    let mut message = String::new();
    for (i, value) in values.0.into_iter().enumerate() {
      if i > 0 {
        write!(&mut message, ", ").map_err(|_| rquickjs::Error::Unknown)?
      }
      self.formatter.format(&mut message, value)?
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

  fn log(&self, values: Rest<Value<'_>>) -> rquickjs::Result<()> {
    self.print(values)
  }

  // fn warn(&self, values: Rest<Value<'_>>) -> rquickjs::Result<()> {
  //   self.print(log::Level::Warn, values)
  // }

  // fn error(&self, values: Rest<Value<'_>>) -> rquickjs::Result<()> {
  //   self.print(log::Level::Error, values)
  // }
}
