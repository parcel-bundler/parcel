use std::{cell::RefCell, path::Path, sync::Arc};

use parcel_core::{
  CodeFrame, CodeHighlight, Diagnostic, FileSystem, Location, OsFileSystem, SourceUrl,
};
use rquickjs::{Context, Ctx, Function, Object, Runtime, class::JsClass, object::Accessor};
use rquickjs_extra_console::Formatter;

use crate::fs::Fs;
pub use crate::{cjs::CjsLoader, esm::create_esm_loader, macros::call_macro};
pub use plugin::JsPlugin;

mod cjs;
mod console;
mod encoding;
mod esm;
mod fs;
mod macros;
mod plugin;
mod process;
mod url;

thread_local! {
  static JS_ENV: RefCell<Option<Context>> = RefCell::new(None);
}

fn with_js_env<F, R>(f: F) -> Result<R, Diagnostic>
where
  F: FnOnce(&Ctx) -> rquickjs::Result<R>,
{
  JS_ENV.with(|cell| {
    let mut context = cell.borrow_mut();

    if context.is_none() {
      let ctx = create_runtime(Arc::new(OsFileSystem {}))
        .map_err(|e| Diagnostic::from_message(e.to_string()))?;
      *context = Some(ctx);
    }

    let env = context.as_ref().unwrap();
    env.with(|ctx| {
      f(&ctx).map_err(|e| {
        let mut file: Option<String> = None;
        let mut line_number: Option<u32> = None;
        let mut column_number: Option<u32> = None;
        let message = if matches!(e, rquickjs::Error::Exception) {
          let e = ctx.catch();
          if let Some(exception) = e.as_exception() {
            let message = exception.to_string();
            if let Some(stack) = exception.stack() {
              let mut line = stack.split('\n').next().unwrap();
              if line.ends_with(')') {
                line = &line[0..line.len() - 1];
              }
              if let Some(column_pos) = line.rfind(':') {
                column_number = line[column_pos + 1..].parse().ok();
                line = &line[0..column_pos];
                if let Some(line_pos) = line.rfind(':') {
                  line_number = line[line_pos + 1..].parse().ok();
                  line = &line[0..line_pos];
                }
              }
              if let Some(pos) = line.find('(') {
                file = Some(line[pos + 1..].to_string());
              }
            }
            message
          } else if let Some(message) = e.as_string() {
            message.to_string().unwrap_or_else(|e| e.to_string())
          } else {
            "Unknown error".into()
          }
        } else {
          e.to_string()
        };

        Diagnostic {
          origin: None,
          message,
          code_frames: if let (Some(file), Some(line), Some(column)) =
            (file, line_number, column_number)
          {
            vec![CodeFrame {
              url: SourceUrl::from_path(Path::new(&file)).ok(),
              code: None,
              language: None,
              code_highlights: vec![CodeHighlight {
                message: None,
                start: Location { line, column },
                end: Location { line, column },
              }],
            }]
          } else {
            Vec::new()
          },
          documentation_url: None,
          hints: Vec::new(),
          severity: parcel_core::DiagnosticSeverity::Error,
        }
      })
    })
  })
}

pub fn create_runtime(fs: Arc<dyn FileSystem>) -> rquickjs::Result<Context> {
  let runtime = Runtime::new()?;
  let ctx = Context::full(&runtime)?;
  let (resolver, loader) = create_esm_loader("/".into(), fs.clone());
  runtime.set_loader(resolver, loader);
  // runtime.set_max_stack_size(10 * 1024 * 1024);

  ctx.with(|ctx| -> rquickjs::Result<()> {
    ctx.store_userdata(CjsLoader::new("/".into(), fs.clone()))?;
    ctx.store_userdata(Fs::new(fs))?;

    let global = ctx.globals();
    let req = Function::new(ctx.clone(), cjs::require)?;
    req.prop("cache", Object::new(ctx.clone()))?;
    req.prop("resolve", Function::new(ctx.clone(), cjs::require_resolve)?)?;
    global.prop("require", req)?;

    global.prop("module", Accessor::new(cjs::get_module, || {}))?;
    global.prop("__dirname", Accessor::new(fs::get_dirname, || {}))?;
    global.prop("__filename", Accessor::new(fs::get_filename, || {}))?;

    let console = console::Console::new(Formatter::default());
    global.set("console", console)?;

    global.set("process", process::Process {})?;
    global.set("global", global.clone())?;

    global.set("TextDecoder", encoding::TextDecoder::constructor(&ctx))?;
    global.set("TextEncoder", encoding::TextEncoder::constructor(&ctx))?;
    global.set("URL", url::URL::constructor(&ctx))?;

    global.set("atob", Function::new(ctx.clone(), encoding::atob)?)?;
    global.set("btoa", Function::new(ctx.clone(), encoding::btoa)?)?;

    Ok(())
  })?;

  Ok(ctx)
}
