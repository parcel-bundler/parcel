use std::{
  path::{Path, PathBuf},
  rc::Rc,
  sync::Arc,
};

use parcel_core::FileSystem;
use parcel_resolver::ModuleType;
use rquickjs::{
  Ctx, Module,
  loader::{Loader, Resolver},
};
use swc_core::{
  common::FileName,
  ecma::parser::{Syntax, TsSyntax},
};

use crate::{
  CjsLoader,
  console::Console,
  fs::{Fs, FsPromises},
  process::Process,
};

pub fn create_esm_loader(
  project_root: String,
  fs: Arc<dyn FileSystem>,
) -> (ModuleResolver, ModuleLoader) {
  let module_resolver = ModuleResolver::new(project_root, fs.clone());
  let resolver = module_resolver.resolver.clone();
  (module_resolver, ModuleLoader { resolver, fs })
}

pub struct ModuleResolver {
  resolver: Rc<parcel_resolver::Resolver<'static>>,
}

impl ModuleResolver {
  pub fn new(project_root: String, fs: Arc<dyn FileSystem>) -> Self {
    let mut resolver = parcel_resolver::Resolver::node_esm(
      Path::new(&project_root),
      parcel_resolver::Cache::new(fs),
    );
    resolver.flags |= parcel_resolver::Flags::TYPESCRIPT;

    ModuleResolver {
      resolver: Rc::new(resolver),
    }
  }
}

impl Resolver for ModuleResolver {
  fn resolve<'js>(&mut self, ctx: &Ctx<'js>, base: &str, name: &str) -> rquickjs::Result<String> {
    let res = self
      .resolver
      .resolve(name, Path::new(base), parcel_resolver::SpecifierType::Esm);

    match res.result {
      Ok(res) => match res.resolution {
        parcel_resolver::Resolution::Path(p) => Ok(p.to_str().unwrap().to_owned()),
        parcel_resolver::Resolution::Builtin { scheme, module } => {
          let module = match module.as_str() {
            "assert" => "assert/",
            "buffer" => "buffer/",
            "console" => return Ok("builtin:console".into()),
            "constants" => "constants-browserify",
            "crypto" => "crypto-browserify",
            "domain" => "domain-browser",
            "events" => "events/",
            "fs" => return Ok("builtin:fs".into()),
            "fs/promises" => return Ok("builtin:fs/promises".into()),
            "os" => "os-browserify",
            "path" => "path-browserify",
            "process" => return Ok("builtin:process".into()),
            "punycode" => "punycode/",
            "querystring" => "querystring-es3",
            "stream" => "stream-browserify",
            "string_decoder" => "string_decoder/",
            "sys" => "util",
            "tty" => "tty-browserify",
            "url" => "url/",
            "util" => "util/",
            "zlib" => "browserify-zlib",
            _ => {
              return Err(rquickjs::Error::new_resolving(base, name));
            }
          };
          return self.resolve(ctx, "/Users/devongovett/dev/parcel", module);
        }
        _ => Err(rquickjs::Error::new_resolving(base, name)),
      },
      Err(e) => Err(rquickjs::Error::new_resolving(base, name)),
    }
  }
}

pub struct ModuleLoader {
  resolver: Rc<parcel_resolver::Resolver<'static>>,
  fs: Arc<dyn FileSystem>,
}

impl Loader for ModuleLoader {
  fn load<'js>(
    &mut self,
    ctx: &Ctx<'js>,
    name: &str,
  ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
    // println!("LOADING {:?}", name);

    if name.starts_with("builtin:") {
      match &name[8..] {
        "console" => return Module::declare_def::<Console, _>(ctx.clone(), "console"),
        "fs" => return Module::declare_def::<Fs, _>(ctx.clone(), "fs"),
        "fs/promises" => return Module::declare_def::<FsPromises, _>(ctx.clone(), "fs/promises"),
        "process" => return Module::declare_def::<Process, _>(ctx.clone(), "process"),
        _ => {}
      }
    }

    let module = match self
      .resolver
      .resolve_module_type(Path::new(name), &Default::default())
    {
      Ok(ModuleType::Module) => {
        let mut source =
          self
            .fs
            .read_to_string(Path::new(name))
            .map_err(|e| rquickjs::Error::Loading {
              name: name.into(),
              message: Some(e.to_string()),
            })?;

        if name.ends_with(".ts") || name.ends_with(".tsx") {
          let cm = Arc::<swc_core::common::SourceMap>::default();
          let compiler = swc::Compiler::new(cm.clone());
          source = swc::try_with_handler(cm.clone(), Default::default(), |handler| {
            let filename = Arc::new(FileName::Real(PathBuf::from(name)));
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
                  ..Default::default()
                },
                ..Default::default()
              },
            )?;
            Ok(result.code)
          })
          .unwrap();
        }

        Module::declare(ctx.clone(), name, source)?
      }
      Ok(ModuleType::CommonJs) => {
        let cjs = ctx.userdata::<CjsLoader>().unwrap();
        let exports = cjs.load(&ctx, &name)?;
        let mut source = format!("const mod = require({:?});\nexport default mod;\n", name);
        if let Some(obj) = exports.as_object() {
          for key in obj.keys() {
            let key: String = key?;
            if key == "default" {
              continue;
            }

            source.push_str("export const ");
            source.push_str(&key);
            source.push_str(" = mod.");
            source.push_str(&key);
            source.push_str(";\n");
          }
        }
        Module::declare(ctx.clone(), name, source)?
      }
      Ok(ModuleType::Json) => {
        let source =
          self
            .fs
            .read_to_string(Path::new(name))
            .map_err(|e| rquickjs::Error::Loading {
              name: name.into(),
              message: Some(e.to_string()),
            })?;
        let source = format!("export default {};\n", source);
        Module::declare(ctx.clone(), name, source)?
      }
      Err(e) => {
        return Err(rquickjs::Error::Loading {
          name: name.into(),
          message: Some(e.to_string()),
        });
      }
    };

    let meta: rquickjs::Object<'js> = module.meta()?;
    meta.prop("url", url::Url::from_file_path(name).unwrap().to_string())?;
    Ok(module)
  }
}
