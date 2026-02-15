use std::{
  cell::RefCell,
  collections::HashMap,
  path::{Path, PathBuf},
  sync::Arc,
};

use parcel_core::{
  AssetType, BuildOptions, BundleFlags, BundleGraph, DependencyResolution, FileSystem,
  MemoryFileSystem, OsFileSystem,
};
use parcel_plugin_js::create_runtime;
use rquickjs::Function;

fn run<F: FnOnce(rquickjs::Value<'_>, Vec<serde_json::Value>) -> rquickjs::Result<()>>(
  paths: Vec<PathBuf>,
  fs: Arc<dyn FileSystem>,
  entry: usize,
  f: F,
) {
  let fs_clone = fs.clone();
  let ctx = create_runtime(fs).unwrap();
  ctx.with(|ctx| {
    let globals = ctx.globals();
    let side_effects = Arc::new(RefCell::new(Vec::<serde_json::Value>::new()));
    let side_effects_clone = side_effects.clone();
    globals
      .set("document", rquickjs::Object::new(ctx.clone()))
      .unwrap();
    globals.set("output", rquickjs::Undefined).unwrap();
    globals
      .set(
        "sideEffect",
        rquickjs::Function::new(
          ctx.clone(),
          move |args: rquickjs::function::Rest<rquickjs::Value>| {
            let values = args
              .0
              .into_iter()
              .map(|v| rquickjs_serde::from_value(v).unwrap());
            side_effects_clone.borrow_mut().extend(values);
          },
        ),
      )
      .unwrap();

    for path in paths {
      let res = rquickjs::Module::import(&ctx, path.to_str().unwrap().to_owned())
        .and_then(|p| p.finish::<rquickjs::Value>());
      match res {
        Ok(_) => {}
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
    }
    let parcel_require: rquickjs::Result<Function> = ctx.globals().get("parcelRequire");
    let output: rquickjs::Result<rquickjs::Value> = parcel_require
      .and_then(|parcel_require| parcel_require.call((entry,)))
      .and_then(|v: rquickjs::Value| {
        if let Some(obj) = v.as_object() {
          if obj.is_empty() {
            let output: rquickjs::Value = ctx.globals().get("output")?;
            if !output.is_undefined() {
              return Ok(output);
            }
          }
        }
        Ok(v)
      });

    match output.and_then(|o| f(o, std::mem::take(&mut side_effects.borrow_mut()))) {
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
          println!(
            "{}",
            fs_clone
              .read_to_string(Path::new(
                &e.split('\n').nth(1).unwrap()[7..]
                  .split(':')
                  .next()
                  .unwrap()
              ))
              .unwrap()
          );
          panic!("exception: {}", e);
        } else {
          panic!("error: {}", err);
        }
      }
    }
  });
}

fn bundle(entry: &Path, output_fs: Arc<dyn FileSystem>) -> BundleGraph {
  bundle_with_options(entry, output_fs, TestOptions::default())
}

fn bundle_with_options(
  entry: &Path,
  output_fs: Arc<dyn FileSystem>,
  options: TestOptions,
) -> BundleGraph {
  let mut env = options.env;
  if !env.contains_key("NODE_ENV") {
    env.insert("NODE_ENV".into(), "test".into());
  }
  let options = BuildOptions {
    // mode: options.mode,
    mode: Default::default(),
    env,
    input_fs: Arc::new(OsFileSystem {}),
    output_fs: output_fs.clone(),
    log_level: parcel_core::LogLevel::Verbose,
  };

  parcel::build(vec![entry.to_str().unwrap().to_owned()], options).unwrap()
}

fn run_test<F: FnOnce(rquickjs::Value<'_>, Vec<serde_json::Value>) -> rquickjs::Result<()>>(
  entry: &Path,
  f: F,
) {
  run_test_with_options(entry, Default::default(), f)
}

fn run_test_with_options<
  F: FnOnce(rquickjs::Value<'_>, Vec<serde_json::Value>) -> rquickjs::Result<()>,
>(
  entry: &Path,
  options: TestOptions,
  f: F,
) {
  let output_fs = Arc::new(MemoryFileSystem::new());
  let bundle_graph = bundle_with_options(entry, output_fs.clone(), options);

  let mut scripts = Vec::new();
  let mut main = 0;

  for bundle in &bundle_graph.bundles {
    if !bundle.flags.contains(BundleFlags::ENTRY) {
      continue;
    }

    let path = bundle.dist_path();
    // println!("{}", output_fs.read_to_string(&path).unwrap());
    match &bundle.ty {
      AssetType::Js => {
        scripts.push(path.clone());
        if let Some(m) = bundle.main_entry_asset {
          main = m;
        }
      }
      AssetType::Html => {
        let deps = parcel_html::transform_html(parcel_html::TransformOptions {
          code: output_fs.read(&path).unwrap(),
          file_path: path.clone(),
          xml: false,
          env: Default::default(),
          hmr: false,
        });

        for dep in deps.dependencies {
          match dep.resolution {
            DependencyResolution::Deferred(req) => {
              println!("inline!");
            }
            _ => {
              let resolved = path.parent().unwrap().join(dep.specifier);

              if resolved.extension().unwrap() == "mjs" {
                let b = bundle_graph
                  .bundles
                  .iter()
                  .find(|b| b.dist_path() == resolved)
                  .unwrap();
                if let Some(m) = b.main_entry_asset {
                  main = m;
                }

                scripts.push(resolved);
              }
            }
          }
        }
      }
      _ => {}
    }
  }

  run(scripts, output_fs, main, f)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestJson {
  #[serde(default)]
  description: String,
  input: String,
  #[serde(default)]
  options: TestOptions,
  output: serde_json::Value,
  #[serde(default)]
  side_effects: Vec<serde_json::Value>,
}

#[derive(serde::Deserialize, Default)]
struct TestOptions {
  #[serde(default)]
  mode: parcel_core::BuildMode,
  #[serde(default)]
  env: HashMap<String, String>,
}

fn run_test_json(path: &Path) {
  let test: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
  if let serde_json::Value::Array(tests) = test {
    for test in tests {
      run_test_json_test(path, test);
    }
  } else {
    run_test_json_test(path, test);
  }
}

fn run_test_json_test(path: &Path, test: serde_json::Value) {
  let test: TestJson = serde_json::from_value(test).unwrap();
  eprintln!("Description: {}", test.description);
  run_test_with_options(
    &path.parent().unwrap().join(test.input),
    test.options,
    |mut v, side_effects| {
      if v.is_function() {
        v = v.as_function().unwrap().call(())?;
      } else if let Some(f) = v
        .as_object()
        .and_then(|o| o.get::<_, rquickjs::Function>("default").ok())
      {
        v = f.call(())?;
      }

      if v.is_promise() {
        v = v.as_promise().unwrap().finish()?;
      }
      let out: serde_json::Value = rquickjs_serde::from_value(v).unwrap();
      assert_eq!(side_effects, test.side_effects);
      assert_eq!(out, test.output);
      Ok(())
    },
  );
}

// mod cjs {
//   use super::*;

//   #[test]
//   fn basic() {
//     run_test("commonjs/index.js", |v| {
//       let f = v.as_function().unwrap();
//       let output: f32 = f.call(()).unwrap();
//       assert_eq!(output, 3.0);
//       Ok(())
//     });
//   }

//   #[test]
//   fn node_modules_browser() {
//     run_test("node_require_browser/main.js", |v| {
//       let f = v.as_function().unwrap();
//       let output: f32 = f.call(()).unwrap();
//       assert_eq!(output, 3.0);
//       Ok(())
//     });
//   }
// }

// mod esm {
//   use super::*;

//   #[test]
//   fn basic() {
//     run_test("es6/index.js", |v| {
//       let obj = v.as_object().unwrap();
//       let f: Function = obj.get("default").unwrap();
//       let output: f32 = f.call(()).unwrap();
//       assert_eq!(output, 3.0);
//       Ok(())
//     });

//     run_test_json("js-export-all");
//     run_test_json("js-import-namespace");
//     run_test_json("js-export-namespace");
//     run_test_json("js-export-destructuring");
//     run_test_json("js-export-many");
//     run_test_json("js-export-import");
//     run_test_json("js-export-import-same");
//   }
// }

// #[test]
// fn test_dynamic_import() {
//   run_test("dynamic/index.js", |v| {
//     let f = v.as_function().unwrap();
//     let output: rquickjs::Promise = f.call(())?;
//     let result: f32 = output.finish()?;
//     assert_eq!(result, 3.0);
//     Ok(())
//   });
// }

// mod env {
//   use super::*;

//   #[test]
//   fn browser() {
//     run_test("env/index.js", |v| {
//       let f = v.as_function().unwrap();
//       let output: String = f.call(())?;
//       assert_eq!(output, "test:test");
//       Ok(())
//     });
//   }

//   #[test]
//   fn computed_var() {
//     run_test("env-computed/index.js", |v| {
//       assert!(v.is_undefined());
//       Ok(())
//     });
//   }

//   #[test]
//   fn computed_string() {
//     run_test_json("env-computed-string");
//   }

//   #[test]
//   fn destructuring() {
//     run_test_json("env-destructuring");
//   }

//   #[test]
//   fn binary() {
//     run_test_json("env-binary-in-expression");
//   }

//   #[test]
//   fn process_browser() {
//     run_test_json("process");
//   }

//   #[test]
//   fn globals() {
//     run_test_json("globals");
//     run_test_json("globals-module-specifier");
//     run_test_json("globals-unused");
//     // run_test_json("global-redeclare");
//   }
// }

#[testing_macros::fixture("../../packages/core/integration-tests/test/integration/**/test.json")]
fn test(file: PathBuf) {
  run_test_json(&file);
}
