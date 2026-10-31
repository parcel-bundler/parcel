//! Node APIs that npm packages (e.g. Babel, PostCSS, posthtml-expressions) rely on,
//! exercised from both CommonJS and ES modules.

#[path = "../../core/tests/support/mod.rs"]
mod test_utils;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use parcel_core::{FileSystem, MemoryFileSystem, PathId};
use parcel_plugin_js::{require_module, with_js_env};

/// Files shared by every case, under `/project`.
const FILES: &[(&str, &str)] = &[
  ("/project/package.json", "{}"),
  ("/project/lib/helper.js", "module.exports = 'helper';"),
  (
    "/project/node_modules/pkg/package.json",
    r#"{"name": "pkg", "main": "main.js", "browser": "browser.js"}"#,
  ),
  (
    "/project/node_modules/pkg/main.js",
    "module.exports = 'node';",
  ),
  (
    "/project/node_modules/pkg/browser.js",
    "module.exports = 'browser';",
  ),
  (
    "/other/node_modules/other-pkg/index.js",
    "module.exports = 'other';",
  ),
];

/// Each case is (label, file name, source). Sources throw on failure.
const CJS_CASES: &[(&str, &str, &str)] = &[
  (
    "vm.runInContext",
    "vm.js",
    r#"const vm = require('vm');
       const ctx = vm.createContext({a: 1});
       if (!vm.isContext(ctx)) throw new Error('isContext');
       const result = vm.runInContext('b = a + 1; a + b', ctx);
       if (result !== 3) throw new Error('completion value: ' + result);
       if (ctx.b !== 2) throw new Error('assignment not written to context: ' + ctx.b);
       if (vm.runInNewContext('x * 2', {x: 4}) !== 8) throw new Error('runInNewContext');
       if (new vm.Script('y + 1').runInNewContext({y: 1}) !== 2) throw new Error('Script');
       let threw = false;
       try { vm.runInContext('1', {}) } catch (e) { threw = true }
       if (!threw) throw new Error('runInContext accepted an object that is not a context');"#,
  ),
  (
    "vm isolation",
    "vm-isolation.js",
    r#"const vm = require('vm');
       if (vm.runInNewContext('Array') === Array) throw new Error('shared intrinsics');
       if (vm.runInNewContext('[]') instanceof Array) throw new Error('array from the same realm');
       if (!Array.isArray(vm.runInNewContext('[]'))) throw new Error('Array.isArray across realms');
       vm.runInNewContext('globalThis.leaked = 1; var declared = 2');
       if (typeof leaked !== 'undefined' || typeof declared !== 'undefined') throw new Error('leaked onto the plugin globals');
       if (vm.runInThisContext('typeof require') !== 'function') throw new Error('runInThisContext');
       if (require('vm') !== require('vm')) throw new Error('module not cached');"#,
  ),
  (
    "vm globals",
    "vm-globals.js",
    r#"const vm = require('vm');
       const ctx = vm.createContext({a: 1, add: (x, y) => x + y});
       vm.runInContext('var v = a; function f() { return v + 1 } a = 10; b = 2', ctx);
       if (ctx.v !== 1 || ctx.f() !== 2) throw new Error('declarations: ' + ctx.v);
       if (ctx.a !== 10) throw new Error('assignment to a sandbox property: ' + ctx.a);
       if (ctx.b !== 2) throw new Error('undeclared assignment: ' + ctx.b);
       ctx.b = 5;
       if (vm.runInContext('b', ctx) !== 5) throw new Error('later sandbox change not visible');
       if (vm.runInContext('add(1, 2)', ctx) !== 3) throw new Error('calling a plugin function');
       if (vm.runInContext('typeof missing', ctx) !== 'undefined') throw new Error('typeof');
       let error;
       try { vm.runInContext('missing', ctx) } catch (e) { error = e }
       if (error?.name !== 'ReferenceError') throw new Error('unknown name: ' + error);"#,
  ),
  (
    "vm live sandbox",
    "vm-live.js",
    r#"const vm = require('vm');
       const ctx = vm.createContext({
         add(key, value) { ctx[key] = value; },
         remove(key) { delete ctx[key]; },
       });
       if (vm.runInContext('add("late", 1); late', ctx) !== 1) throw new Error('property added mid-run');
       if (vm.runInContext('remove("late"); typeof late', ctx) !== 'undefined') throw new Error('property deleted mid-run');
       ctx.JSON = 'shadowed';
       if (vm.runInContext('JSON', ctx) !== 'shadowed') throw new Error('sandbox should shadow intrinsics');
       delete ctx.JSON;
       // Builtins are copied onto the sandbox, so deletion has no fallback.
       if (vm.runInContext('typeof JSON', ctx) !== 'undefined') throw new Error('deleted intrinsic still visible');
       class Locals { get computed() { return 42; } }
       const locals = vm.createContext(new Locals());
       if (vm.runInContext('computed', locals) !== 42) throw new Error('inherited getter');
       if (Object.getPrototypeOf(locals) !== Locals.prototype) throw new Error('sandbox prototype changed');
       if (vm.runInContext('toString', locals) !== locals.toString) throw new Error('inherited method changed');"#,
  ),
  (
    "vm global writes",
    "vm-writes.js",
    r#"const vm = require('vm');
       const ctx = vm.createContext({read() { return ctx.x; }});
       if (vm.runInContext('var x = 1; read()', ctx) !== 1) throw new Error('declaration not immediately visible');
       ctx.x = 2;
       if (vm.runInContext('x', ctx) !== 2 || ctx.x !== 2) throw new Error('sandbox update overwritten');
       if (vm.runInContext('x = 3; read()', ctx) !== 3) throw new Error('assignment not immediately visible');
       const assign = vm.runInContext('() => { later = 4; x++; }', ctx);
       assign();
       if (ctx.later !== 4 || ctx.x !== 4) throw new Error('escaped function writes lost');
       ctx.removable = 5;
       if (!vm.runInContext('delete removable', ctx) || 'removable' in ctx) throw new Error('deletion not forwarded');
       vm.runInContext('function f() { return x; }', ctx);
       ctx.x = 6;
       if (ctx.f() !== 6) throw new Error('function reads stale global');
       if (vm.runInContext('eval("var evaluated = 7"); evaluated', ctx) !== 7 || ctx.evaluated !== 7) throw new Error('eval declaration');
       if (vm.runInContext('Function("return x")()', ctx) !== 6) throw new Error('Function global');
       try { vm.runInContext('beforeThrow = 8; throw 1', ctx); } catch (e) {}
       if (ctx.beforeThrow !== 8) throw new Error('write before exception lost');
       vm.runInContext('let lexical = 9; const constant = 10', ctx);
       if ('lexical' in ctx || 'constant' in ctx) throw new Error('lexical binding copied');
       if (vm.runInContext('lexical + constant', ctx) !== 19) throw new Error('lexical binding lost');
       let strictError;
       try { vm.runInContext('"use strict"; missing = 1', ctx); } catch (e) { strictError = e; }
       if (strictError?.name !== 'ReferenceError' || 'missing' in ctx) throw new Error('strict assignment');"#,
  ),
  (
    "vm copied globals",
    "vm-copied-globals.js",
    r#"const vm = require('vm');
       const ctx = vm.createContext(Object.assign(Object.create(null), {x: 1}));
       if (Object.getPrototypeOf(ctx) !== null || vm.runInContext('x', ctx) !== 1) throw new Error('null prototype');
       if (vm.runInContext('this', ctx) !== ctx || ctx.globalThis !== ctx) throw new Error('global identity');
       if (!vm.runInContext('globalThis === this', ctx)) throw new Error('old globalThis');
       if (ctx.Array === Array || !vm.runInContext('[] instanceof Array', ctx)) throw new Error('intrinsic realm');
       const array = Object.getOwnPropertyDescriptor(ctx, 'Array');
       if (array.enumerable || !array.writable || !array.configurable) throw new Error('builtin descriptor');
       const undef = Object.getOwnPropertyDescriptor(ctx, 'undefined');
       if (undef.enumerable || undef.writable || undef.configurable) throw new Error('constant descriptor');
       const overrides = vm.createContext({Object: 1, Reflect: 2, globalThis: 3});
       if (vm.runInContext('Object + Reflect + globalThis', overrides) !== 6) throw new Error('overrides overwritten');
       const inherited = vm.createContext(Object.create({JSON: 'inherited'}));
       if (vm.runInContext('JSON', inherited) !== 'inherited' || Object.hasOwn(inherited, 'JSON')) throw new Error('inherited override');
       vm.runInContext('Object.defineProperty(globalThis, "value", {get() {return x}, configurable: true})', ctx);
       ctx.x = 2;
       const value = Object.getOwnPropertyDescriptor(ctx, 'value');
       if (typeof value.get !== 'function' || value.enumerable || ctx.value !== 2) throw new Error('accessor descriptor');
       vm.runInContext('globalThis[Symbol.for("vm.test")] = 3', ctx);
       if (ctx[Symbol.for('vm.test')] !== 3) throw new Error('symbol write');"#,
  ),
  (
    "vm errors",
    "vm-errors.js",
    r#"const vm = require('vm');
       let error;
       try { vm.runInNewContext('throw new TypeError("boom")') } catch (e) { error = e }
       if (error?.message !== 'boom' || error.name !== 'TypeError') throw new Error('thrown error: ' + error);
       error = undefined;
       try { vm.runInNewContext('{', {}, {filename: 'bad.js'}) } catch (e) { error = e }
       if (error?.name !== 'SyntaxError') throw new Error('syntax error: ' + error);
       const ctx = vm.createContext({});
       try { vm.runInContext('throw 1', ctx) } catch (e) {}
       if (vm.runInContext('1 + 1', ctx) !== 2) throw new Error('context unusable after an error');"#,
  ),
  (
    "module.createRequire",
    "module.js",
    r#"const {createRequire, builtinModules, isBuiltin} = require('module');
       const req = createRequire(testPath('/project/lib/index.js'));
       if (req('./helper') !== 'helper') throw new Error('relative require');
       if (req.resolve('./helper') !== testPath('/project/lib/helper.js')) throw new Error('resolve: ' + req.resolve('./helper'));
       if (createRequire(testPath('/project/lib/'))('./helper') !== 'helper') throw new Error('directory base');
       if (createRequire(testUrl('file:///project/lib/index.js'))('./helper') !== 'helper') throw new Error('file URL base');
       if (!builtinModules.includes('fs')) throw new Error('builtinModules');
       if (!isBuiltin('node:path') || isBuiltin('pkg')) throw new Error('isBuiltin');"#,
  ),
  (
    "require.resolve paths",
    "resolve.js",
    r#"const resolved = require.resolve('other-pkg', {paths: [testPath('/nowhere'), testPath('/other')]});
       if (resolved !== testPath('/other/node_modules/other-pkg/index.js')) throw new Error('paths: ' + resolved);
       let threw = false;
       try { require.resolve('missing-pkg', {paths: [testPath('/other')]}) } catch (e) { threw = true }
       if (!threw) throw new Error('missing module resolved');"#,
  ),
  (
    "main field over browser field",
    "fields.js",
    r#"if (require('pkg') !== 'node') throw new Error('loaded ' + require('pkg'));"#,
  ),
  (
    "fs.existsSync",
    "fs.js",
    r#"const fs = require('fs');
       if (!fs.existsSync('lib/helper.js')) throw new Error('relative file');
       if (fs.readFileSync('lib/helper.js', 'utf8') !== "module.exports = 'helper';") throw new Error('relative read');
       if (!fs.existsSync(testPath('/project/lib/helper.js'))) throw new Error('file');
       if (!fs.existsSync(testPath('/project/lib'))) throw new Error('directory');
       if (!fs.existsSync('/')) throw new Error('root');
       if (fs.existsSync(testPath('/project/missing.js'))) throw new Error('missing file');"#,
  ),
  (
    "process",
    "process.js",
    r#"if ('browser' in process) throw new Error('process.browser');
       if (process.stdout.fd !== 1 || process.stderr.fd !== 2) throw new Error('fd');
       if (process.stderr.isTTY !== false) throw new Error('isTTY');
       if (process.stdout.write('') !== true) throw new Error('write');"#,
  ),
];

const ESM_CASES: &[(&str, &str, &str)] = &[
  (
    "vm",
    "vm.mjs",
    r#"import vm, {runInNewContext, Script} from 'vm';
       if (runInNewContext('x * 2', {x: 4}) !== 8) throw new Error('runInNewContext');
       if (new Script('1 + 1').runInThisContext() !== 2) throw new Error('Script');
       if (vm.runInNewContext !== runInNewContext) throw new Error('default export');"#,
  ),
  (
    "module",
    "module.mjs",
    r#"import {createRequire, isBuiltin} from 'module';
       const require = createRequire(import.meta.url);
       if (require('./lib/helper.js') !== 'helper') throw new Error('createRequire(import.meta.url)');
       if (!isBuiltin('vm')) throw new Error('isBuiltin');"#,
  ),
  (
    "node: specifiers",
    "node-prefix.mjs",
    r#"import {runInNewContext} from 'node:vm';
       import {createRequire} from 'node:module';
       if (runInNewContext('1') !== 1) throw new Error('node:vm');
       if (typeof createRequire !== 'function') throw new Error('node:module');"#,
  ),
  (
    "fs named exports",
    "fs.mjs",
    r#"import fs, {existsSync, readFileSync, promises} from 'fs';
       import {readFile} from 'fs/promises';
       if (!existsSync(testPath('/project/lib/helper.js'))) throw new Error('existsSync');
       if (readFileSync(testPath('/project/lib/helper.js'), 'utf8') !== "module.exports = 'helper';") throw new Error('readFileSync');
       if (typeof promises.readFile !== 'function' || typeof readFile !== 'function') throw new Error('promises');
       if (fs.existsSync !== existsSync) throw new Error('default export');"#,
  ),
];

fn fixture_fs() -> Arc<dyn FileSystem> {
  let fs = MemoryFileSystem::new();
  for (path, contents) in FILES {
    let path = test_utils::path(path);
    fs.create_dir_all(PathId::new(path.parent().unwrap()))
      .unwrap();
    fs.write(PathId::new(&path), &contents.as_bytes().to_vec())
      .unwrap();
  }
  Arc::new(fs)
}

fn run_cases(
  cases: &[(&str, &str, &str)],
  run: impl Fn(&rquickjs::Ctx, &str) -> rquickjs::Result<()>,
) {
  let fs = fixture_fs();
  let cwd = PathId::new(test_utils::path("/project").as_path());
  let mut failed = Vec::new();
  for (label, file, source) in cases {
    let path = test_utils::path(&format!("/project/{file}"))
      .to_string_lossy()
      .into_owned();
    fs.write(
      PathId::new(Path::new(&path)),
      &test_utils::js(source).as_bytes().to_vec(),
    )
    .unwrap();
    if let Err(diagnostics) = with_js_env(fs.clone(), &HashMap::new(), cwd, |ctx| run(ctx, &path)) {
      let mut buf = Vec::new();
      diagnostics.report(&mut buf).unwrap();
      println!("FAIL {label}\n{}", String::from_utf8_lossy(&buf));
      failed.push(*label);
    }
  }
  assert!(failed.is_empty(), "failed: {}", failed.join(", "));
}

#[test]
fn commonjs() {
  run_cases(CJS_CASES, |ctx, path| {
    require_module(ctx, path)?;
    Ok(())
  });
}

#[test]
fn es_modules() {
  run_cases(ESM_CASES, |ctx, path| {
    rquickjs::Module::import(ctx, path)?.finish::<rquickjs::Value>()?;
    Ok(())
  });
}
