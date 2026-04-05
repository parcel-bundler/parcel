use std::{
  path::{Path, PathBuf},
  sync::Arc,
};

use parcel_core::FileSystem;
use parcel_resolver::ModuleType;
use rquickjs::{Ctx, JsLifetime, Module, Object, Value, context::EvalOptions, function};
use swc::config::ModuleConfig;
use swc_core::{
  common::FileName,
  ecma::parser::{Syntax, TsSyntax},
};

#[derive(JsLifetime)]
pub struct CjsLoader {
  resolver: parcel_resolver::Resolver<'static>,
  fs: Arc<dyn FileSystem>,
}

impl CjsLoader {
  pub fn new(project_root: String, fs: Arc<dyn FileSystem>) -> Self {
    CjsLoader {
      resolver: parcel_resolver::Resolver::parcel(
        Path::new(&project_root),
        parcel_resolver::Cache::new(fs.clone()),
      ),
      fs,
    }
  }

  pub fn resolve(&self, base: &str, name: &str) -> rquickjs::Result<String> {
    let res = self
      .resolver
      .resolve(name, Path::new(base), parcel_resolver::SpecifierType::Cjs);

    match res.result {
      Ok(res) => match res.resolution {
        parcel_resolver::Resolution::Path(p) => Ok(p.to_str().unwrap().to_owned()),
        parcel_resolver::Resolution::Builtin { scheme, module } => match module.as_str() {
          "path" => {
            Ok("/Users/devongovett/dev/parcel/node_modules/path-browserify/index.js".into())
          }
          "os" => Ok("/Users/devongovett/dev/parcel/node_modules/os-browserify/browser.js".into()),
          "tty" => Ok("/Users/devongovett/dev/parcel/node_modules/tty-browserify/index.js".into()),
          "assert" => {
            Ok("/Users/devongovett/dev/parcel/node_modules/assert/build/assert.js".into())
          }
          // _ => Err(rquickjs::Error::new_resolving(base, name)),
          _ => Ok(
            "/Users/devongovett/dev/parcel/packages/utils/node-resolver-core/src/_empty.js".into(),
          ),
        },
        _ => Err(rquickjs::Error::new_resolving(base, name)),
      },
      Err(_) => Err(rquickjs::Error::new_resolving(base, name)),
    }
  }

  pub fn load<'js>(&self, ctx: &Ctx<'js>, resolved: &str) -> rquickjs::Result<Value<'js>> {
    let globals = ctx.globals();
    let require: Object = globals.get("require")?;
    let cache: Object = require.get("cache")?;

    if let Ok(module) = cache.get::<_, Object>(resolved) {
      let exports: Value = module.get("exports")?;
      return Ok(exports);
    }

    println!("require {}", resolved);

    match self
      .resolver
      .resolve_module_type(Path::new(resolved), &Default::default())
    {
      Ok(ModuleType::Module) => {
        let promise: rquickjs::Promise<'_> = Module::import(&ctx, resolved)?;
        let module: Object = promise.finish()?;
        Ok(module.into_value())
      }
      Ok(ModuleType::CommonJs) => {
        let module = Object::new(ctx.clone())?;
        module.set("exports", Object::new(ctx.clone()))?;
        cache.set(resolved, module.clone())?;

        let mut options = EvalOptions::default();
        options.global = false;
        options.strict = false;
        options.filename = Some(resolved.into());

        let mut source = self.fs.read_to_string(Path::new(resolved)).unwrap();
        if resolved.ends_with(".ts") || resolved.ends_with(".tsx") {
          let cm = Arc::<swc_core::common::SourceMap>::default();
          let compiler = swc::Compiler::new(cm.clone());
          source = swc::try_with_handler(cm.clone(), Default::default(), |handler| {
            let filename = Arc::new(FileName::Real(PathBuf::from(resolved)));
            let file = cm.new_source_file(filename, source);
            let result = compiler.process_js_file(
              file,
              handler,
              &swc::config::Options {
                swcrc: false,
                config: swc::config::Config {
                  jsc: swc::config::JscConfig {
                    syntax: Some(Syntax::Typescript(TsSyntax::default())),
                    ..Default::default()
                  },
                  module: Some(ModuleConfig::CommonJs(Default::default())),
                  ..Default::default()
                },
                ..Default::default()
              },
            )?;
            Ok(result.code)
          })
          .unwrap();
        }

        let mut code = String::new();
        code.push_str("var exports = module.exports;\n");
        code.push_str(&source);
        let _: Value = ctx.eval_with_options(code, options)?;

        let exports: Value = module.get("exports")?;
        Ok(exports)
      }
      Ok(ModuleType::Json) => {
        let module = Object::new(ctx.clone())?;
        cache.set(resolved, module.clone())?;

        let source = self.fs.read(Path::new(resolved)).unwrap();
        module.set("exports", ctx.json_parse(source)?)?;

        let exports: Value = module.get("exports")?;
        Ok(exports)
      }
      Err(e) => Err(rquickjs::Error::Loading {
        name: resolved.into(),
        message: Some(e.to_string()),
      }),
    }
  }
}

#[function]
pub fn require(ctx: Ctx<'_>, specifier: String) -> rquickjs::Result<Value<'_>> {
  let cjs = ctx.userdata::<CjsLoader>().unwrap();
  let from = ctx.script_or_module_name(0).unwrap().to_string()?;
  if let Ok(resolved) = cjs.resolve(&from, &specifier) {
    cjs.load(&ctx, &resolved)
  } else {
    Err(
      ctx.throw(
        rquickjs::String::from_str(ctx.clone(), &format!("Could not resolve {:?}", specifier))?
          .into_value(),
      ),
    )
  }
}

#[function]
pub fn require_resolve(ctx: Ctx<'_>, specifier: String) -> rquickjs::Result<String> {
  let cjs = ctx.userdata::<CjsLoader>().unwrap();
  let from = ctx.script_or_module_name(0).unwrap().to_string()?;
  cjs.resolve(&from, &specifier)
}

pub fn get_module<'js>(ctx: Ctx<'js>) -> rquickjs::Result<Value<'js>> {
  let from = ctx.script_or_module_name(0).unwrap();
  let globals = ctx.globals();
  let require: Object = globals.get("require")?;
  let cache: Object = require.get("cache")?;
  cache.get(from)
}
