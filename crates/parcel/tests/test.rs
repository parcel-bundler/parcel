use std::{collections::HashMap, path::Path, sync::Arc};

use parcel_core::{BuildOptions, FileSystem, MemoryFileSystem, OsFileSystem};
use parcel_plugin_js::create_runtime;
use rquickjs::{Function, context::EvalOptions};

fn run<F: FnOnce(rquickjs::Value<'_>) -> rquickjs::Result<()>>(
  filename: &str,
  fs: Arc<dyn FileSystem>,
  code: &str,
  f: F,
) {
  let ctx = create_runtime(fs).unwrap();
  ctx.with(|ctx| {
    let mut opts = EvalOptions::default();
    opts.filename = Some(filename.into());
    opts.global = false;
    let _: () = match ctx.eval_with_options(code, opts) {
      Ok(v) => v,
      Err(err) => {
        if err.is_exception() {
          let e = ctx.catch();
          let e = if let Some(exception) = e.as_exception() {
            exception.to_string()
          } else if let Some(message) = e.as_string() {
            message.to_string().unwrap_or_else(|e| e.to_string())
          } else {
            "Unknown error".into()
          };
          panic!("exception: {}", e);
        } else {
          panic!("error: {}", err);
        }
      }
    };
    let parcel_require: Function = ctx.globals().get("parcelRequire").unwrap();
    let output: rquickjs::Value = parcel_require.call((0,)).unwrap();
    match f(output) {
      Ok(v) => v,
      Err(err) => {
        if err.is_exception() {
          let e = ctx.catch();
          let e = if let Some(exception) = e.as_exception() {
            exception.to_string()
          } else if let Some(message) = e.as_string() {
            message.to_string().unwrap_or_else(|e| e.to_string())
          } else {
            "Unknown error".into()
          };
          panic!("exception: {}", e);
        } else {
          panic!("error: {}", err);
        }
      }
    }
  });
}

fn run_test<F: FnOnce(rquickjs::Value<'_>) -> rquickjs::Result<()>>(entry: &str, f: F) {
  let mode = parcel_core::BuildMode::Development;
  let env = HashMap::new();
  let output_fs = Arc::new(MemoryFileSystem::new());
  let options = BuildOptions {
    env,
    input_fs: Arc::new(OsFileSystem {}),
    output_fs: output_fs.clone(),
    log_level: parcel_core::LogLevel::Verbose,
    mode,
  };

  parcel::build(
    vec![format!(
      "/Users/devongovett/dev/parcel/packages/core/integration-tests/test/integration/{}",
      entry
    )],
    options,
  )
  .unwrap();

  let code = output_fs
    .read_to_string(Path::new(
      "/Users/devongovett/dev/parcel/packages/core/integration-tests/test/dist/index.js",
    ))
    .unwrap();

  run(
    "/Users/devongovett/dev/parcel/packages/core/integration-tests/test/dist/index.js",
    output_fs,
    &code,
    f,
  )
}

#[test]
fn test_cjs() {
  run_test("commonjs/index.js", |v| {
    let f = v.as_function().unwrap();
    let output: f32 = f.call(()).unwrap();
    assert_eq!(output, 3.0);
    Ok(())
  });
}

#[test]
fn test_esm() {
  run_test("es6/index.js", |v| {
    let obj = v.as_object().unwrap();
    let f: Function = obj.get("default").unwrap();
    let output: f32 = f.call(()).unwrap();
    assert_eq!(output, 3.0);
    Ok(())
  });
}

#[test]
fn test_dynamic_import() {
  run_test("dynamic/index.js", |v| {
    let f = v.as_function().unwrap();
    let output: rquickjs::Promise = f.call(())?;
    let result: f32 = output.finish()?;
    assert_eq!(result, 3.0);
    Ok(())
  });
}
