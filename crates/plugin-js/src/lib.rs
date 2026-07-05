use std::{
  borrow::Cow,
  cell::RefCell,
  collections::HashMap,
  path::{Path, PathBuf},
  rc::Rc,
  sync::Arc,
};

use parcel_core::{
  CodeFrame, CodeHighlight, Diagnostic, DiagnosticList, Environment, FileSystem, Location, PathId,
  SourceUrl,
};
use rquickjs::{
  Context, Ctx, Function, Object, Persistent, Runtime, Value, class::JsClass, object::Accessor,
};
use rquickjs_extra_console::Formatter;

use crate::fs::FileSystemData;
pub use crate::{cjs::CjsLoader, esm::create_esm_loader, macros::call_macro};
pub use plugin::JsPlugin;

mod bytecode;
mod cjs;
mod console;
mod encoding;
mod esm;
mod fs;
mod macros;
mod plugin;
mod process;
mod structured_clone;
mod url;
mod url_search_params;

pub struct JsEnv {
  pub context: Context,
  rejected_promises: Rc<RefCell<HashMap<Persistent<Value<'static>>, Persistent<Value<'static>>>>>,
}

thread_local! {
  static JS_ENV: RefCell<Option<JsEnv>> = RefCell::new(None);
}

pub fn with_js_env<F, R>(
  fs: Arc<dyn FileSystem>,
  env_vars: &HashMap<String, String>,
  cwd: PathId,
  f: F,
) -> Result<R, DiagnosticList>
where
  F: FnOnce(&Ctx) -> rquickjs::Result<R>,
{
  JS_ENV.with(|cell| {
    let mut context = cell.borrow_mut();

    if context.is_none() {
      let ctx = create_runtime(fs, env_vars, cwd, Environment::Node)
        .map_err(|e| DiagnosticList::from(Diagnostic::from_message(e.to_string())))?;
      *context = Some(ctx);
    }

    let env = context.as_ref().unwrap();
    env.with(f)
  })
}

impl JsEnv {
  pub fn with<F, R>(&self, f: F) -> Result<R, DiagnosticList>
  where
    F: FnOnce(&Ctx) -> rquickjs::Result<R>,
  {
    self.context.with(|ctx| {
      f(&ctx)
        .map_err(|e| {
          let diagnostic = if matches!(e, rquickjs::Error::Exception) {
            error_to_diagnostic(ctx.catch())
          } else {
            Diagnostic {
              origin: None,
              message: e.to_string(),
              code_frames: Vec::new(),
              documentation_url: None,
              hints: Vec::new(),
              severity: parcel_core::DiagnosticSeverity::Error,
            }
          };
          let mut diagnostics = vec![diagnostic];
          diagnostics.extend(collect_rejected_promises(&ctx, self));
          DiagnosticList(diagnostics)
        })
        .and_then(|result| {
          let diagnostics = collect_rejected_promises(&ctx, self);
          if !diagnostics.is_empty() {
            return Err(DiagnosticList(diagnostics));
          }
          Ok(result)
        })
    })
  }
}

impl Drop for JsEnv {
  fn drop(&mut self) {
    self.context.with(|ctx| {
      drop(collect_rejected_promises(&ctx, self));
    });
  }
}

pub fn create_runtime(
  fs: Arc<dyn FileSystem>,
  env_vars: &HashMap<String, String>,
  cwd: PathId,
  environment: Environment,
) -> rquickjs::Result<JsEnv> {
  let runtime = Runtime::new()?;
  let ctx = Context::full(&runtime)?;
  let rejected_promises = Rc::new(RefCell::new(HashMap::new()));
  let env = JsEnv {
    context: ctx,
    rejected_promises: rejected_promises.clone(),
  };

  let (resolver, loader) = create_esm_loader(PathId::root(), fs.clone(), environment);
  runtime.set_loader(resolver, loader);
  runtime.set_max_stack_size(10 * 1024 * 1024); // 10 MB
  runtime.set_host_promise_rejection_tracker(Some(Box::new(
    move |ctx, promise, reason, handled| {
      let persistent = Persistent::save(&ctx, promise);
      if !handled {
        rejected_promises
          .borrow_mut()
          .insert(persistent, Persistent::save(&ctx, reason));
      } else {
        if let Some(value) = rejected_promises.borrow_mut().remove(&persistent) {
          drop(value.restore(&ctx));
        }
        drop(persistent.restore(&ctx));
      }
    },
  )));

  env.context.with(|ctx| -> rquickjs::Result<()> {
    ctx.store_userdata(CjsLoader::new(PathId::root(), fs.clone()))?;
    ctx.store_userdata(FileSystemData(fs))?;

    let global = ctx.globals();
    let console = console::Console::new(Formatter::default());
    global.set("console", console)?;

    global.set("TextDecoder", encoding::TextDecoder::constructor(&ctx))?;
    global.set("TextEncoder", encoding::TextEncoder::constructor(&ctx))?;
    global.set("URL", url::URL::constructor(&ctx))?;
    global.set(
      "URLSearchParams",
      url_search_params::URLSearchParams::constructor(&ctx),
    )?;

    global.set("atob", Function::new(ctx.clone(), encoding::atob)?)?;
    global.set("btoa", Function::new(ctx.clone(), encoding::btoa)?)?;
    global.set(
      "structuredClone",
      Function::new(ctx.clone(), structured_clone::structured_clone)?,
    )?;

    if environment != Environment::Browser {
      let req = Function::new(ctx.clone(), cjs::require)?;
      req.prop("cache", Object::new(ctx.clone()))?;
      req.prop("resolve", Function::new(ctx.clone(), cjs::require_resolve)?)?;
      global.prop("require", req)?;

      global.prop("__dirname", Accessor::new(fs::get_dirname, || {}))?;
      global.prop("__filename", Accessor::new(fs::get_filename, || {}))?;
      global.set(
        "process",
        process::Process::new(ctx.clone(), env_vars, cwd)?,
      )?;
      global.set("global", global.clone())?;

      let cjs = ctx.userdata::<CjsLoader>().unwrap();
      if let Some(buffer) = cjs
        .resolve(&ctx, "", "buffer")
        .and_then(|resolved| cjs.load(&ctx, &resolved))?
        .into_object()
      {
        let buffer: Object = buffer.get("Buffer")?;
        global.set("Buffer", buffer)?;
      }
    }

    Ok(())
  })?;

  Ok(env)
}

fn error_to_diagnostic<'js>(e: Value<'js>) -> Diagnostic {
  let mut file: Option<String> = None;
  let mut line_number: Option<u32> = None;
  let mut column_number: Option<u32> = None;
  let message = if let Some(exception) = e.as_exception() {
    let message = exception.message().unwrap_or_else(|| exception.to_string());
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
  };

  Diagnostic {
    origin: None,
    message,
    code_frames: if let (Some(file), Some(line), Some(column)) = (file, line_number, column_number)
    {
      vec![CodeFrame {
        url: Some(SourceUrl::from_path(&PathId::new(Path::new(&file)))),
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
}

fn collect_rejected_promises(ctx: &Ctx, env: &JsEnv) -> Vec<Diagnostic> {
  let mut rejected_promises = env.rejected_promises.borrow_mut();
  if !rejected_promises.is_empty() {
    rejected_promises
      .drain()
      .map(|(promise, reason)| {
        drop(promise.restore(&ctx));
        let reason = reason.restore(&ctx).unwrap();
        error_to_diagnostic(reason)
      })
      .collect()
  } else {
    Vec::new()
  }
}

pub fn await_promise<'a, 'js>(ctx: &'a Ctx<'js>, res: Value<'js>) -> rquickjs::Result<Value<'js>> {
  if let Some(promise) = res.as_promise() {
    loop {
      if let Some(result) = promise.result::<rquickjs::Value>() {
        return result;
      }

      if !ctx.execute_pending_job() {
        let err = ctx.catch();
        if !err.is_null() {
          return Err(ctx.throw(err));
        }
      }
    }
  }

  Ok(res)
}

pub fn require_module<'js>(ctx: &Ctx<'js>, path: &str) -> rquickjs::Result<Value<'js>> {
  let cjs = ctx.userdata::<CjsLoader>().unwrap();
  cjs.load(&ctx, path)
}

pub fn require_source<'js>(
  ctx: &Ctx<'js>,
  path: &str,
  source: &str,
) -> rquickjs::Result<Value<'js>> {
  let cjs = ctx.userdata::<CjsLoader>().unwrap();
  cjs.load_source(&ctx, path, Cow::Borrowed(source))
}
