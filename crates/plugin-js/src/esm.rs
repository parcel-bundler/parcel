use std::{
  path::{Path, PathBuf},
  rc::Rc,
  sync::Arc,
};

use parcel_core::{Environment, ExportsCondition, FileSystem, PathId};
use parcel_resolver::ModuleType;
use rquickjs::{
  Ctx, Module,
  loader::{Loader, Resolver},
  module::WriteOptions,
};
use swc_core::{
  common::FileName,
  ecma::parser::{Syntax, TsSyntax},
};

use crate::{
  CjsLoader, bytecode,
  console::Console,
  fs::{Fs, FsPromises},
  process::Process,
  url::UrlModule,
};

pub fn create_esm_loader(
  project_root: PathId,
  fs: Arc<dyn FileSystem>,
  environment: Environment,
) -> (ModuleResolver, ModuleLoader) {
  let module_resolver = ModuleResolver::new(project_root, fs.clone());
  let resolver = module_resolver.resolver.clone();
  (
    module_resolver,
    ModuleLoader {
      resolver,
      fs,
      environment,
    },
  )
}

pub struct ModuleResolver {
  resolver: Rc<parcel_resolver::Resolver<'static>>,
  fs: Arc<dyn FileSystem>,
}

impl ModuleResolver {
  pub fn new(project_root: PathId, fs: Arc<dyn FileSystem>) -> Self {
    let mut resolver = parcel_resolver::Resolver::node_esm(project_root);
    resolver.flags |= parcel_resolver::Flags::TYPESCRIPT;
    resolver.conditions |= ExportsCondition::SOURCE;

    ModuleResolver {
      resolver: Rc::new(resolver),
      fs,
    }
  }
}

impl Resolver for ModuleResolver {
  fn resolve<'js>(&mut self, _ctx: &Ctx<'js>, base: &str, name: &str) -> rquickjs::Result<String> {
    let res = self.resolver.resolve(
      name,
      parcel_resolver::PathId::new(Path::new(base)),
      parcel_resolver::SpecifierType::Esm,
      &*self.fs,
    );

    match res {
      Ok(res) => match res.resolution {
        parcel_resolver::Resolution::Path(p) => Ok(p.to_path_buf().to_str().unwrap().to_owned()),
        parcel_resolver::Resolution::Builtin { module, .. } => {
          return Ok(format!("builtin:{}", module));
        }
        _ => Err(rquickjs::Error::new_resolving(base, name)),
      },
      Err(_) => Err(rquickjs::Error::new_resolving(base, name)),
    }
  }
}

pub struct ModuleLoader {
  resolver: Rc<parcel_resolver::Resolver<'static>>,
  fs: Arc<dyn FileSystem>,
  environment: Environment,
}

impl ModuleLoader {
  fn load_cjs<'js>(
    &self,
    ctx: &Ctx<'js>,
    name: &str,
  ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
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
    Ok(Module::declare(ctx.clone(), name, source)?)
  }
}

impl Loader for ModuleLoader {
  fn load<'js>(
    &mut self,
    ctx: &Ctx<'js>,
    name: &str,
  ) -> rquickjs::Result<Module<'js, rquickjs::module::Declared>> {
    // println!("LOADING {:?}", name);

    if name.starts_with("builtin:") && self.environment != Environment::Browser {
      match &name[8..] {
        "console" => return Module::declare_def::<Console, _>(ctx.clone(), "console"),
        "fs" => return Module::declare_def::<Fs, _>(ctx.clone(), "fs"),
        "fs/promises" => return Module::declare_def::<FsPromises, _>(ctx.clone(), "fs/promises"),
        "process" => return Module::declare_def::<Process, _>(ctx.clone(), "process"),
        "url" => return Module::declare_def::<UrlModule, _>(ctx.clone(), "url"),
        name => {
          let cjs = ctx.userdata::<CjsLoader>().unwrap();
          let name = cjs.resolve_builtin(&ctx, name, false)?;
          return self.load_cjs(ctx, &name);
        }
      }
    }

    let module_type = if self.environment == Environment::Browser {
      ModuleType::Module
    } else {
      self
        .resolver
        .resolve_module_type(PathId::new(Path::new(name)), &*self.fs)
        .map_err(|e| rquickjs::Error::Loading {
          name: name.into(),
          message: Some(e.to_string()),
        })?
    };

    let module = match module_type {
      ModuleType::Module => {
        if name.ends_with(".css") {
          Module::declare(ctx.clone(), name, "")?
        } else {
          let mut source = self
            .fs
            .read_to_string(PathId::new(Path::new(name)))
            .map_err(|e| rquickjs::Error::Loading {
              name: name.into(),
              message: Some(e.to_string()),
            })?;

          // Another thread may already have compiled this module (including any TypeScript
          // transpilation); if so, deserialize its bytecode instead of re-parsing.
          let source_hash = bytecode::source_hash(&source);
          if let Some(bytes) = bytecode::get(bytecode::Kind::Module, name, source_hash) {
            // SAFETY: the bytes were produced by `Module::write` below for this same source.
            unsafe { Module::load(ctx.clone(), &bytes)? }
          } else {
            if name.ends_with(".ts") || name.ends_with(".tsx") {
              let cm = Arc::<swc_core::common::SourceMap>::default();
              let compiler = swc::Compiler::new(cm.clone());
              let globals = swc_core::common::Globals::new();

              source = swc_core::common::GLOBALS
                .set(&globals, || {
                  swc::try_with_handler(cm.clone(), Default::default(), |handler| {
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
                })
                .map_err(|e| rquickjs::Error::Loading {
                  name: name.into(),
                  message: Some(e.to_pretty_string()),
                })?;
            }

            let module = Module::declare(ctx.clone(), name, source)?;
            bytecode::insert(
              bytecode::Kind::Module,
              name,
              source_hash,
              module.write(WriteOptions::default())?.into(),
            );
            module
          }
        }
      }
      ModuleType::CommonJs => self.load_cjs(ctx, name)?,
      ModuleType::Json => {
        let source = self
          .fs
          .read_to_string(parcel_core::PathId::new(Path::new(name)))
          .map_err(|e| rquickjs::Error::Loading {
            name: name.into(),
            message: Some(e.to_string()),
          })?;
        let source = format!("export default {};\n", source);
        Module::declare(ctx.clone(), name, source)?
      }
    };

    let meta: rquickjs::Object<'js> = module.meta()?;
    meta.prop("url", url::Url::from_file_path(name).unwrap().to_string())?;
    Ok(module)
  }
}
