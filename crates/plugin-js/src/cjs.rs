use std::{borrow::Cow, path::Path, sync::Arc};

use parcel_core::{ExportsCondition, FileSystem, PathId, resolve_path};
use parcel_resolver::ModuleType;
use rquickjs::{Ctx, FromJs, Function, IntoJs, JsLifetime, Module, Object, Value, function};
use rust_embed::Embed;

use crate::{
  buffer, bytecode, crypto,
  fs::{Fs, FsPromises},
  path,
  transpile::ModuleKind,
  url, zlib,
};

#[derive(Embed)]
#[folder = "builtins/"]
struct Builtins;

#[derive(JsLifetime)]
pub struct CjsLoader {
  resolver: parcel_resolver::Resolver<'static>,
  fs: Arc<dyn FileSystem>,
}

impl CjsLoader {
  pub fn new(project_root: PathId, fs: Arc<dyn FileSystem>) -> Self {
    let mut resolver = parcel_resolver::Resolver::node(project_root);
    resolver.flags |= parcel_resolver::Flags::TYPESCRIPT;
    resolver.entries |= parcel_resolver::Fields::BROWSER;
    resolver.conditions |= ExportsCondition::SOURCE;
    CjsLoader { resolver, fs }
  }

  pub fn resolve(&self, ctx: &Ctx, base: &str, name: &str) -> rquickjs::Result<String> {
    if base.starts_with("builtin:") {
      if name.starts_with(".") {
        let builtin_base = base.strip_prefix("builtin:").unwrap();
        let resolved = resolve_path(Path::new(builtin_base), Path::new(name));
        let mut candidates = vec![resolved.clone()];
        if resolved.extension().is_none() {
          let mut file = resolved.clone();
          file.add_extension("js");
          candidates.push(file);
          candidates.push(resolved.join("index.js"));
          candidates.push(resolved.join("index.json"));
        }

        for candidate in candidates {
          let candidate = candidate.to_str().unwrap();
          if Builtins::get(candidate).is_some() {
            return Ok(format!("builtin:{candidate}"));
          }
        }

        let mut resolved = resolved;
        if resolved.extension().is_none() {
          resolved.add_extension("js");
        }
        return Ok(format!("builtin:{}", resolved.to_str().unwrap()));
      } else if name.starts_with("builtin:") {
        return Ok(name.to_string());
      } else {
        return self.resolve_builtin(ctx, name, false);
      }
    }

    let res = self.resolver.resolve(
      name,
      parcel_resolver::PathId::new(Path::new(base)),
      parcel_resolver::SpecifierType::Cjs,
      &*self.fs,
    );

    match res {
      Ok(res) => match res.resolution {
        parcel_resolver::Resolution::Path(p) => Ok(p.to_path_buf().to_str().unwrap().to_owned()),
        parcel_resolver::Resolution::Builtin { module, .. } => {
          return self.resolve_builtin(ctx, &module, true);
        }
        _ => Err(rquickjs::Exception::throw_message(
          ctx,
          &format!("Could not resolve '{}' from '{}'", name, base),
        )),
      },
      Err(_) => Err(rquickjs::Exception::throw_message(
        ctx,
        &format!("Could not resolve '{}' from '{}'", name, base),
      )),
    }
  }

  pub fn resolve_builtin(&self, ctx: &Ctx, module: &str, error: bool) -> rquickjs::Result<String> {
    let module = match module {
      "assert" => "assert",
      "buffer" => "buffer",
      "console" => return Ok("builtin:console".into()),
      "constants" => "constants",
      "crypto" => return Ok("builtin:crypto".into()),
      "domain" => "domain-browser",
      "events" => "events",
      "fs" => return Ok("builtin:fs".into()),
      "fs/promises" => return Ok("builtin:fs/promises".into()),
      "os" => "os-browserify",
      "path" => return Ok("builtin:path".into()),
      "process" => return Ok("builtin:process".into()),
      "punycode" => "punycode",
      "querystring" => "querystring-es3",
      "stream" => "stream-browserify",
      "string_decoder" => "string_decoder",
      "sys" => "util",
      "tty" => "tty-browserify",
      "url" => return Ok("builtin:url".into()),
      "util" => "util",
      "zlib" => "native-zlib",
      _ => {
        if error {
          return Err(rquickjs::Exception::throw_message(
            ctx,
            &format!("Unsupported node builtin '{}'", module),
          ));
        }
        module.strip_suffix("/").unwrap_or(module)
      }
    };
    if !module.contains("/") {
      return Ok(format!("builtin:{}/index.js", module));
    }
    if !module.ends_with(".js") {
      return Ok(format!("builtin:{}.js", module));
    }
    return Ok(format!("builtin:{}", module));
  }

  pub fn load<'js>(&self, ctx: &Ctx<'js>, resolved: &str) -> rquickjs::Result<Value<'js>> {
    let globals = ctx.globals();
    let require: Object = globals.get("require")?;
    let cache: Object = require.get("cache")?;

    if let Ok(module) = cache.get::<_, Object>(resolved) {
      let exports: Value = module.get("exports")?;
      return Ok(exports);
    }

    if resolved.starts_with("builtin:") {
      match &resolved[8..] {
        "console" => {
          return globals.get("console");
        }
        "crypto" => {
          return Ok(crypto::crypto_module(ctx)?.into_value());
        }
        "fs" => {
          return Fs {}.into_js(ctx);
        }
        "fs/promises" => {
          return FsPromises {}.into_js(ctx);
        }
        "process" => {
          return globals.get("process");
        }
        "path" => {
          return Ok(path::path_module(ctx)?.into_value());
        }
        "url" => {
          return Ok(url::url_module(ctx)?.into_value());
        }
        "base64-js/index.js" => {
          return Ok(buffer::base64_module(ctx)?.into_value());
        }
        "buffer-native/index.js" => {
          return Ok(buffer::native_module(ctx)?.into_value());
        }
        "zlib-native" | "zlib-native/index.js" => {
          return Ok(zlib::native_module(ctx)?.into_value());
        }
        module => {
          let embedded_module = module
            .strip_prefix("url-legacy/")
            .map(|module| format!("url/{module}"));
          let embedded_module = embedded_module.as_deref().unwrap_or(module);
          if let Some(file) = Builtins::get(embedded_module) {
            if embedded_module.ends_with(".json") {
              let module = Object::new(ctx.clone())?;
              cache.set(resolved, module.clone())?;
              module.set("exports", ctx.json_parse(file.data.as_ref())?)?;
              return module.get("exports");
            }
            let source = match file.data {
              Cow::Borrowed(data) => Cow::Borrowed(std::str::from_utf8(data).unwrap()),
              Cow::Owned(data) => Cow::Owned(String::from_utf8(data).unwrap()),
            };
            return self.load_cjs(ctx, resolved, source, cache);
          } else {
            return Err(rquickjs::Exception::throw_message(
              ctx,
              &format!("Could not load builtin '{}'", module),
            ));
          }
        }
      }
    }

    // println!("require {}", resolved);

    let pathid = PathId::new(Path::new(resolved));
    match self.resolver.resolve_module_type(pathid, &*self.fs) {
      Ok(ModuleType::Module) => {
        let promise: rquickjs::Promise<'_> = Module::import(&ctx, resolved)?;
        let module: Object = promise.finish()?;
        Ok(module.into_value())
      }
      Ok(ModuleType::CommonJs) => {
        let source = self
          .fs
          .read_to_string(pathid)
          .map_err(|e| rquickjs::Error::Loading {
            name: resolved.into(),
            message: Some(e.to_string()),
          })?;
        self.load_cjs(ctx, resolved, Cow::Owned(source), cache)
      }
      Ok(ModuleType::Json) => {
        let module = Object::new(ctx.clone())?;
        cache.set(resolved, module.clone())?;

        let source = self.fs.read(pathid).map_err(|e| rquickjs::Error::Loading {
          name: resolved.into(),
          message: Some(e.to_string()),
        })?;
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

  pub fn load_source<'js>(
    &self,
    ctx: &Ctx<'js>,
    resolved: &str,
    source: Cow<'_, str>,
  ) -> rquickjs::Result<Value<'js>> {
    let globals = ctx.globals();
    let require: Object = globals.get("require")?;
    let cache: Object = require.get("cache")?;

    if let Ok(module) = cache.get::<_, Object>(resolved) {
      let exports: Value = module.get("exports")?;
      return Ok(exports);
    }

    self.load_cjs(ctx, resolved, source, cache)
  }

  pub fn load_cjs<'js>(
    &self,
    ctx: &Ctx<'js>,
    resolved: &str,
    mut source: Cow<'_, str>,
    cache: Object<'js>,
  ) -> rquickjs::Result<Value<'js>> {
    let module = Object::new(ctx.clone())?;
    module.set("exports", Object::new(ctx.clone()))?;
    module.set("require", Function::new(ctx.clone(), require)?)?;
    cache.set(resolved, module.clone())?;

    if resolved.ends_with(".css") {
      return module.get("exports");
    }

    // Another thread may already have compiled this module (including any TypeScript
    // transpilation); if so, skip straight to executing its bytecode.
    let source_hash = bytecode::source_hash(&source);
    if let Some(f) = bytecode::load_script(ctx, resolved, source_hash) {
      let f = Function::from_js(ctx, f?)?;
      f.call::<_, ()>((module.clone(), module.get::<_, Value>("exports")?))?;
      return module.get("exports");
    }

    if resolved.ends_with(".ts") || resolved.ends_with(".tsx") {
      source = Cow::Owned(
        crate::transpile::transpile_ts(resolved, source.into_owned(), ModuleKind::CommonJs)
          .map_err(|message| rquickjs::Error::Loading {
            name: resolved.into(),
            message: Some(message),
          })?,
      );
    }

    let mut code = String::new();
    code.push_str("(function (module, exports) {");
    code.push_str(&source);
    code.push_str("\n})");
    let f = Function::from_js(
      ctx,
      bytecode::compile_script(ctx, resolved, source_hash, &code)?,
    )?;
    f.call::<_, ()>((module.clone(), module.get::<_, Value>("exports")?))?;

    let exports: Value = module.get("exports")?;
    Ok(exports)
  }
}

#[function]
pub fn require(ctx: Ctx<'_>, specifier: String) -> rquickjs::Result<Value<'_>> {
  let cjs = ctx.userdata::<CjsLoader>().unwrap();
  let from = ctx.script_or_module_name(0).unwrap().to_string()?;
  let resolved = cjs.resolve(&ctx, &from, &specifier)?;
  cjs.load(&ctx, &resolved)
}

#[function]
pub fn require_resolve(ctx: Ctx<'_>, specifier: String) -> rquickjs::Result<String> {
  let cjs = ctx.userdata::<CjsLoader>().unwrap();
  let from = ctx.script_or_module_name(0).unwrap().to_string()?;
  cjs.resolve(&ctx, &from, &specifier)
}
