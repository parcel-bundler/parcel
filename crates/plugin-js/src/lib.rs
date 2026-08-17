use std::{borrow::Cow, cell::RefCell, collections::HashMap, path::Path, rc::Rc, sync::Arc};

use parcel_core::{
  CodeFrame, CodeHighlight, Diagnostic, DiagnosticList, Environment, FileSystem, Location, PathId,
  SourceUrl,
};
use rquickjs::{
  Coerced, Context, Ctx, Function, Object, Persistent, Runtime, Value, class::JsClass,
  function::This, object::Accessor,
};
use rquickjs_extra_console::Formatter;

use crate::fs::FileSystemData;
pub use crate::{cjs::CjsLoader, esm::create_esm_loader, macros::call_macro};
pub use plugin::JsPlugin;

mod buffer;
mod bytecode;
mod cjs;
mod console;
mod crypto;
mod encoding;
mod esm;
mod fs;
mod macros;
mod path;
mod plugin;
mod process;
mod structured_clone;
mod transpile;
mod url;
mod url_search_params;
mod zlib;

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
    global.set("crypto", crypto::webcrypto_module(&ctx)?)?;

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
  let object = e.as_object();
  let mut stack = None;
  let message = if let Some(exception) = e.as_exception() {
    let message = exception.message().unwrap_or_else(|| exception.to_string());
    stack = exception.stack();
    message
  } else if let Some(message) = e.as_string() {
    message.to_string().unwrap_or_else(|e| e.to_string())
  } else if let Some(object) = object {
    stack = object_string(object, "stack");
    object_string(object, "message").unwrap_or_else(|| "Unknown error".into())
  } else {
    "Unknown error".into()
  };

  let location = object
    .and_then(object_location)
    .or_else(|| stack.as_deref().and_then(stack_location));

  Diagnostic {
    origin: None,
    message,
    code_frames: if let Some((file, line, column)) = location {
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

fn object_string(object: &Object, property: &str) -> Option<String> {
  object
    .get::<_, Option<Coerced<String>>>(property)
    .ok()
    .flatten()
    .map(|value| value.0)
}

fn object_location(object: &Object) -> Option<(String, u32, u32)> {
  let file = object_string(object, "filename").or_else(|| object_string(object, "fileName"))?;
  let line = object.get::<_, Option<u32>>("line").ok().flatten()?;
  let column = object.get::<_, Option<u32>>("column").ok().flatten()?;
  Some((file, line, column))
}

fn stack_location(stack: &str) -> Option<(String, u32, u32)> {
  let mut frame = stack.split('\n').next()?;
  if frame.ends_with(')') {
    frame = &frame[0..frame.len() - 1];
  }

  let column_pos = frame.rfind(':')?;
  let column = frame[column_pos + 1..].parse().ok()?;
  frame = &frame[0..column_pos];

  let line_pos = frame.rfind(':')?;
  let line = frame[line_pos + 1..].parse().ok()?;
  frame = &frame[0..line_pos];

  let file_pos = frame.find('(')?;
  Some((frame[file_pos + 1..].to_string(), line, column))
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
    let result = Rc::new(RefCell::new(None));
    let resolved_result = result.clone();
    let resolved = Function::new(ctx.clone(), move |value: Value<'js>| {
      *resolved_result.borrow_mut() = Some(Ok(value));
    })?;
    let rejected_result = result.clone();
    let rejected = Function::new(ctx.clone(), move |reason: Value<'js>| {
      *rejected_result.borrow_mut() = Some(Err(reason));
    })?;

    promise
      .then()?
      .call::<_, ()>((This(promise.clone()), resolved, rejected))?;

    loop {
      if let Some(result) = result.borrow_mut().take() {
        return match result {
          Ok(value) => Ok(value),
          Err(reason) => Err(ctx.throw(reason)),
        };
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

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn converts_error_like_objects_to_diagnostics() {
    let runtime = Runtime::new().unwrap();
    let context = Context::full(&runtime).unwrap();

    context.with(|ctx| {
      let error = ctx
        .eval::<Value, _>(
          r#"({
            message: 42,
            filename: "/tmp/source.less",
            line: 3,
            column: 7,
            stack: "    at fallback (/tmp/fallback.js:10:20)"
          })"#,
        )
        .unwrap();
      let diagnostic = error_to_diagnostic(error);

      assert_eq!(diagnostic.message, "42");
      assert_location(&diagnostic, "/tmp/source.less", 3, 7);
    });
  }

  #[test]
  fn falls_back_to_stack_locations_for_error_like_objects() {
    let runtime = Runtime::new().unwrap();
    let context = Context::full(&runtime).unwrap();

    context.with(|ctx| {
      let error = ctx
        .eval::<Value, _>(
          r#"({
            message: "failed",
            stack: "    at transform (/tmp/plugin.js:12:8)"
          })"#,
        )
        .unwrap();
      let diagnostic = error_to_diagnostic(error);

      assert_eq!(diagnostic.message, "failed");
      assert_location(&diagnostic, "/tmp/plugin.js", 12, 8);
    });
  }

  #[test]
  fn converts_native_errors_to_diagnostics() {
    let runtime = Runtime::new().unwrap();
    let context = Context::full(&runtime).unwrap();

    context.with(|ctx| {
      let error = ctx.eval::<Value, _>("new Error('failed')").unwrap();
      let diagnostic = error_to_diagnostic(error);

      assert_eq!(diagnostic.message, "failed");
    });
  }

  #[test]
  fn awaited_rejections_are_not_reported_as_unhandled() {
    let env = promise_env();
    let diagnostics = env
      .with(|ctx| {
        let promise = ctx.eval::<Value, _>("Promise.reject({message: 'failed'})")?;
        await_promise(ctx, promise)?;
        Ok(())
      })
      .unwrap_err();

    assert_eq!(diagnostics.0.len(), 1);
    assert_eq!(diagnostics.0[0].message, "failed");
  }

  #[test]
  fn unhandled_rejections_are_still_reported() {
    let env = promise_env();
    let diagnostics = env
      .with(|ctx| {
        ctx.eval::<Value, _>("Promise.reject({message: 'unhandled'})")?;
        while ctx.execute_pending_job() {}
        Ok(())
      })
      .unwrap_err();

    assert_eq!(diagnostics.0.len(), 1);
    assert_eq!(diagnostics.0[0].message, "unhandled");
  }

  #[test]
  fn awaited_resolutions_return_their_value() {
    let env = promise_env();
    let result = env
      .with(|ctx| {
        let promise = ctx.eval::<Value, _>("Promise.resolve(42)")?;
        Ok(await_promise(ctx, promise)?.as_int().unwrap())
      })
      .unwrap();

    assert_eq!(result, 42);
  }

  fn promise_env() -> JsEnv {
    create_runtime(
      Arc::new(parcel_core::MemoryFileSystem::new()),
      &HashMap::new(),
      PathId::root(),
      Environment::Browser,
    )
    .unwrap()
  }

  fn assert_location(diagnostic: &Diagnostic, file: &str, line: u32, column: u32) {
    assert_eq!(diagnostic.code_frames.len(), 1);
    let frame = &diagnostic.code_frames[0];
    assert_eq!(
      frame.url,
      Some(SourceUrl::from_path(&PathId::new(Path::new(file))))
    );
    assert_eq!(frame.code_highlights.len(), 1);
    let highlight = &frame.code_highlights[0];
    assert_eq!(highlight.start, Location { line, column });
    assert_eq!(highlight.end, Location { line, column });
  }
}
