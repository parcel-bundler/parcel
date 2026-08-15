//! Exercises TypeScript plugin transpilation through the real QuickJS runtime.
//!
//! These cover the swc pipeline in `src/transpile.rs`, which replaced
//! `swc::Compiler::process_js_file`. The fixture suite in `crates/parcel` does not
//! load TypeScript plugins, so without this the pipeline is untested.

use std::collections::HashMap;
use std::sync::Arc;

use parcel_core::{FileSystem, OsFileSystem, PathId};
use parcel_plugin_js::{require_source, with_js_env};

/// (label, typescript source, expression asserting the result). Scripts throw on failure.
const CASES: &[(&str, &str)] = &[
  (
    "type annotations are stripped",
    r#"const n: number = 41;
       function add(a: number, b: number): number { return a + b }
       module.exports.value = add(n, 1);"#,
  ),
  (
    "interfaces and type aliases are erased",
    r#"interface User { name: string }
       type Id = string | number;
       const u: User = {name: "ok"};
       const id: Id = 1;
       module.exports.value = u.name === "ok" && id === 1 ? 42 : 0;"#,
  ),
  (
    "import type is elided",
    r#"import type {Foo} from "./nonexistent-module";
       const x: Foo | number = 42;
       module.exports.value = x;"#,
  ),
  (
    "enums still exist at runtime",
    r#"enum Color { Red = 41, Blue }
       module.exports.value = Color.Blue;"#,
  ),
  (
    "generics and as-casts",
    r#"function first<T>(xs: T[]): T { return xs[0] }
       const v = first<number>([42, 1]) as number;
       module.exports.value = v;"#,
  ),
  (
    "class with parameter properties and modifiers",
    r#"class Point {
         constructor(public x: number, private y: number) {}
         sum(): number { return this.x + this.y }
       }
       module.exports.value = new Point(40, 2).sum();"#,
  ),
  (
    "namespaces",
    r#"namespace N { export const v: number = 42 }
       module.exports.value = N.v;"#,
  ),
  (
    "esm syntax is converted to commonjs",
    r#"const answer: number = 42;
       export default answer;
       export const other: string = "x";"#,
  ),
];

fn run(label: &str, source: &str) -> Result<f64, String> {
  let fs: Arc<dyn FileSystem> = Arc::new(OsFileSystem {});
  let env_vars: HashMap<String, String> = HashMap::new();
  let cwd = PathId::new(&std::env::current_dir().unwrap());

  with_js_env(fs, &env_vars, cwd, |ctx| {
    // A distinct path per case so the module cache doesn't collide.
    let path = format!("/{}.ts", label.replace(' ', "_"));
    let exports = require_source(ctx, &path, source)?;
    let obj = exports.as_object().expect("exports should be an object");
    // `export default` lands on `default` once converted to CJS.
    let value: f64 = if obj.contains_key("value").unwrap_or(false) {
      obj.get("value")?
    } else {
      obj.get("default")?
    };
    Ok(value)
  })
  .map_err(|diagnostics| {
    let mut buf = Vec::new();
    diagnostics.report(&mut buf).unwrap();
    String::from_utf8_lossy(&buf).into_owned()
  })
}

#[test]
fn typescript_plugins_transpile() {
  let mut failed = Vec::new();
  for (label, source) in CASES {
    match run(label, source) {
      Ok(v) if v == 42.0 => {}
      Ok(v) => failed.push(format!("{label}: expected 42, got {v}")),
      Err(e) => failed.push(format!("{label}: {e}")),
    }
  }
  assert!(failed.is_empty(), "{}", failed.join("\n"));
}

#[test]
fn syntax_errors_are_reported_not_swallowed() {
  let err = run("broken", "const x: number = ;").expect_err("should fail to transpile");
  assert!(
    !err.trim().is_empty(),
    "a syntax error must produce a diagnostic, got: {err:?}"
  );
}
