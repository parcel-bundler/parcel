use std::{borrow::Cow, path::Path, sync::Arc};

use parcel_core::{ExportsCondition, FileSystem, PathId, resolve_path};
use parcel_resolver::ModuleType;
use rquickjs::{Ctx, FromJs, Function, IntoJs, JsLifetime, Module, Object, Value, function};

use crate::{
  buffer, bytecode, crypto,
  fs::{Fs, FsPromises},
  path,
  transpile::ModuleKind,
  url, vm, zlib,
};

// (path, uncompressed length, deflated bytes), sorted by path; see build.rs.
include!(concat!(env!("OUT_DIR"), "/builtins_gen.rs"));

struct Builtins;

struct EmbeddedFile {
  data: Cow<'static, [u8]>,
}

impl Builtins {
  fn contains(path: &str) -> bool {
    BUILTINS.binary_search_by_key(&path, |(p, ..)| p).is_ok()
  }

  fn get(path: &str) -> Option<EmbeddedFile> {
    use std::io::Read;
    let i = BUILTINS.binary_search_by_key(&path, |(p, ..)| p).ok()?;
    let (_, raw_len, compressed) = BUILTINS[i];
    let mut data = Vec::with_capacity(raw_len);
    flate2::read::DeflateDecoder::new(compressed)
      .read_to_end(&mut data)
      .ok()?;
    Some(EmbeddedFile {
      data: Cow::Owned(data),
    })
  }
}

#[derive(JsLifetime)]
pub struct CjsLoader {
  resolver: parcel_resolver::Resolver<'static>,
  fs: Arc<dyn FileSystem>,
}

impl CjsLoader {
  pub fn new(project_root: PathId, fs: Arc<dyn FileSystem>) -> Self {
    let mut resolver = parcel_resolver::Resolver::node(project_root);
    resolver.flags |= parcel_resolver::Flags::TYPESCRIPT;
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
          let candidate = candidate
            .to_str()
            .unwrap()
            .replace(std::path::MAIN_SEPARATOR, "/");
          if Builtins::contains(&candidate) {
            return Ok(format!("builtin:{candidate}"));
          }
        }

        let mut resolved = resolved;
        if resolved.extension().is_none() {
          resolved.add_extension("js");
        }
        return Ok(format!(
          "builtin:{}",
          resolved
            .to_str()
            .unwrap()
            .replace(std::path::MAIN_SEPARATOR, "/")
        ));
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
      "module" => return Ok("builtin:module".into()),
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
      "vm" => return Ok("builtin:vm".into()),
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
        "module" => {
          return module_module(ctx);
        }
        "vm" => {
          // Cached so every import shares one registry of contexts.
          let exports = vm::vm_module(ctx)?;
          let module = Object::new(ctx.clone())?;
          module.set("exports", exports.clone())?;
          cache.set(resolved, module)?;
          return Ok(exports);
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

/// `require.resolve(specifier, {paths})`. When `paths` is given, each entry is a
/// directory to start the lookup from, tried in order, as in Node.
#[function]
pub fn require_resolve<'js>(
  ctx: Ctx<'js>,
  specifier: String,
  options: rquickjs::function::Opt<Object<'js>>,
) -> rquickjs::Result<String> {
  let cjs = ctx.userdata::<CjsLoader>().unwrap();
  let paths: Option<Vec<String>> = match options.0 {
    Some(options) => options.get("paths")?,
    None => None,
  };
  let Some(paths) = paths else {
    let from = ctx.script_or_module_name(0).unwrap().to_string()?;
    return cjs.resolve(&ctx, &from, &specifier);
  };

  for dir in &paths {
    // The resolver looks up from the parent of `base`, so resolve from a file inside `dir`.
    let base = Path::new(dir).join("index.js");
    if let Ok(resolved) = cjs.resolve(&ctx, base.to_str().unwrap(), &specifier) {
      return Ok(resolved);
    }
    // Clear the exception from the failed attempt before trying the next path.
    ctx.catch();
  }

  Err(rquickjs::Exception::throw_message(
    &ctx,
    &format!("Cannot find module '{}'", specifier),
  ))
}

/// Builtins that can be required, as reported by `module.builtinModules`.
const BUILTIN_MODULES: &[&str] = &[
  "assert",
  "buffer",
  "console",
  "constants",
  "crypto",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "module",
  "os",
  "path",
  "process",
  "punycode",
  "querystring",
  "stream",
  "string_decoder",
  "sys",
  "tty",
  "url",
  "util",
  "vm",
  "zlib",
];

const MODULE_SOURCE: &str = r#"(function (requireFrom, resolveFrom, builtinModules) {
  function toPath(filename) {
    if (typeof filename !== 'string' || filename.startsWith('file:')) {
      return require('url').fileURLToPath(filename);
    }
    return filename;
  }

  function createRequire(filename) {
    let from = toPath(filename);
    // A trailing slash means a directory, so resolve from a file inside it.
    if (from.endsWith('/')) {
      from += 'index.js';
    }
    function req(id) {
      return requireFrom(from, id);
    }
    req.resolve = function (id, options) {
      return options && options.paths
        ? require.resolve(id, options)
        : resolveFrom(from, id);
    };
    req.cache = require.cache;
    return req;
  }

  function isBuiltin(name) {
    return builtinModules.includes(name.replace(/^node:/, ''));
  }

  return {createRequire, builtinModules, isBuiltin};
})"#;

/// Node's `module` builtin.
fn module_module<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
  let factory: Function = ctx.eval(MODULE_SOURCE)?;
  let require_from = Function::new(
    ctx.clone(),
    |ctx: Ctx<'js>, from: String, specifier: String| -> rquickjs::Result<Value<'js>> {
      let cjs = ctx.userdata::<CjsLoader>().unwrap();
      let resolved = cjs.resolve(&ctx, &from, &specifier)?;
      cjs.load(&ctx, &resolved)
    },
  )?;
  let resolve_from = Function::new(
    ctx.clone(),
    |ctx: Ctx<'js>, from: String, specifier: String| -> rquickjs::Result<String> {
      let cjs = ctx.userdata::<CjsLoader>().unwrap();
      cjs.resolve(&ctx, &from, &specifier)
    },
  )?;
  factory.call((require_from, resolve_from, BUILTIN_MODULES.to_vec()))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn embedded_builtins_roundtrip() {
    assert!(!BUILTINS.is_empty());
    // The table must be sorted for the binary search in `get`/`contains`.
    assert!(BUILTINS.windows(2).all(|w| w[0].0 < w[1].0));

    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("builtins");
    for (path, raw_len, _) in BUILTINS {
      let file = Builtins::get(path).unwrap();
      assert_eq!(file.data.len(), *raw_len, "{path}");
      let on_disk = std::fs::read(root.join(path)).unwrap();
      assert_eq!(*file.data, on_disk[..], "{path}");
    }

    assert!(!Builtins::contains("not/a/builtin.js"));
    assert!(Builtins::get("not/a/builtin.js").is_none());
  }
}
