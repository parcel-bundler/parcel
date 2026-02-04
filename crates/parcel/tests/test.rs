use std::{collections::HashMap, path::Path, sync::Arc};

use parcel_core::{FileSystem, MemoryFileSystem, OsFileSystem, ParcelOptions, SourceUrl};
use rquickjs::{Context, Function, Runtime, context::EvalOptions};

#[test]
fn run_test() {
  let mode = parcel_core::BuildMode::Development;
  let env = HashMap::new();
  let output_fs = Arc::new(MemoryFileSystem::new());
  let options = Arc::new(ParcelOptions {
    env,
    input_fs: Arc::new(OsFileSystem {}),
    output_fs: output_fs.clone(),
    log_level: parcel_core::LogLevel::Verbose,
    mode,
    project_root: SourceUrl::from_path(Path::new(
      "/Users/devongovett/dev/parcel/packages/core/integration-tests/test/integration/commonjs",
      // "/Users/devongovett/dev/esbuild/require/parcel2/bench/three/",
    ))
    .unwrap(),
  });

  output_fs.mkdir(Path::new("/test")).unwrap();
  output_fs.mkdir(Path::new("/test/library")).unwrap();
  output_fs.mkdir(Path::new("/test/library/dist")).unwrap();

  parcel::build(
    vec![
      "/Users/devongovett/dev/parcel/packages/core/integration-tests/test/integration/commonjs/index.js".into(),
    ],
    options,
  ).unwrap();

  let code = output_fs
    .read_to_string(Path::new("/test/library/dist/index.js"))
    .unwrap();

  println!("{}", code);

  let runtime = Runtime::new().unwrap();
  let ctx = Context::full(&runtime).unwrap();
  ctx.with(|ctx| {
    let mut opts = EvalOptions::default();
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
    let output: Function = parcel_require.call((0,)).unwrap();
    let output: f64 = output.call(()).unwrap();
    println!("OUTPUT: {:?}", output);
  });

  // println!("{:?}", code);
}
