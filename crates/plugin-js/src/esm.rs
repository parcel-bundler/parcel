use std::{path::Path, rc::Rc, sync::Arc};

use parcel_core::{FileSystem, OsFileSystem};
use parcel_resolver::ModuleType;
use rquickjs::{
  Ctx, Module,
  loader::{Loader, Resolver},
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
    ModuleResolver {
      resolver: Rc::new(parcel_resolver::Resolver::node_esm(
        Path::new(&project_root),
        parcel_resolver::Cache::new(fs),
      )),
    }
  }
}

impl Resolver for ModuleResolver {
  fn resolve<'js>(&mut self, _ctx: &Ctx<'js>, base: &str, name: &str) -> rquickjs::Result<String> {
    let res = self
      .resolver
      .resolve(name, Path::new(base), parcel_resolver::SpecifierType::Esm);

    match res.result {
      Ok(res) => match res.resolution {
        parcel_resolver::Resolution::Path(p) => Ok(p.to_str().unwrap().to_owned()),
        _ => Err(rquickjs::Error::new_resolving(base, name)),
      },
      Err(e) => {
        println!("ERROR: {:?}", e);
        Err(rquickjs::Error::new_resolving(base, name))
      }
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

    let module = match self
      .resolver
      .resolve_module_type(Path::new(name), &Default::default())
    {
      Ok(ModuleType::Module) => {
        let source =
          self
            .fs
            .read_to_string(Path::new(name))
            .map_err(|e| rquickjs::Error::Loading {
              name: name.into(),
              message: Some(e.to_string()),
            })?;
        Module::declare(ctx.clone(), name, source)?
      }
      Ok(ModuleType::CommonJs) => {
        let source = format!("export default require({:?});\n", name);
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
