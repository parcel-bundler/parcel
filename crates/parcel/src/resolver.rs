use std::{path::Path, sync::Arc};

use parcel_core::{
  AssetRequest, AssetType, Dependency, DependencyResolution, Diagnostic, Resolver, SourceUrl,
  SpecifierType,
};
use parcel_resolver::{OsFileSystem, Resolution, ResolutionAndQuery};

pub struct DefaultResolver {
  resolver: parcel_resolver::Resolver<'static>,
}

impl DefaultResolver {
  pub fn new(project_root: String) -> Self {
    let fs = Arc::new(OsFileSystem);
    DefaultResolver {
      resolver: parcel_resolver::Resolver::parcel(
        Path::new(&project_root),
        parcel_resolver::Cache::new(fs),
      ),
    }
  }
}

impl Resolver for DefaultResolver {
  fn resolve(
    &self,
    dep: &Dependency,
    specifier: &str,
    pipeline: Option<&str>,
  ) -> Result<DependencyResolution, Vec<Diagnostic>> {
    let resolve_from = dep.resolve_from.as_ref().unwrap();
    let mut res = self.resolver.resolve(
      specifier,
      &resolve_from.to_file_path().unwrap(),
      match dep.specifier_type {
        SpecifierType::Esm => parcel_resolver::SpecifierType::Esm,
        SpecifierType::Commonjs => parcel_resolver::SpecifierType::Cjs,
        SpecifierType::Url => parcel_resolver::SpecifierType::Url,
        _ => parcel_resolver::SpecifierType::Esm,
      },
    );

    let side_effects = if let Ok(ResolutionAndQuery {
      resolution: Resolution::Path(p),
      ..
    }) = &res.result
    {
      match self.resolver.resolve_side_effects(p, &res.invalidations) {
        Ok(side_effects) => side_effects,
        Err(err) => {
          res.result = Err(err);
          true
        }
      }
    } else {
      true
    };

    match res.result {
      Ok(res) => match res.resolution {
        Resolution::Path(path) => {
          let url = SourceUrl::from_path(&path).unwrap();
          Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
            ty: AssetType::from_url(&url),
            url,
            code: None,
            env: dep.env.clone(),
            pipeline: pipeline.map(|p| p.into()),
            side_effects,
          })))
        }
        Resolution::External => Ok(DependencyResolution::External),
        Resolution::Empty => {
          todo!()
        }
        Resolution::Global(global) => {
          todo!()
        }
        Resolution::Builtin { scheme, module } => {
          todo!()
        }
      },
      Err(e) => {
        Err(vec![]) // TODO
      }
    }
  }
}
