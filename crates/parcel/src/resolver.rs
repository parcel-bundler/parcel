use std::{path::Path, sync::Arc};

use parcel_core::{
  AssetRequest, AssetType, Dependency, DependencyResolution, DiagnosticList, Resolver, SourceUrl,
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
  ) -> Result<DependencyResolution, DiagnosticList> {
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
          let url =
            SourceUrl::from_path_and_query(&path, res.query.as_ref().map(|s| &s[1..])).unwrap();
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
        Resolution::Empty => Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
          ty: AssetType::Js,
          url: SourceUrl::parse("file:///empty.js").unwrap(),
          code: Some(vec![]),
          env: dep.env.clone(),
          pipeline: pipeline.map(|p| p.into()),
          side_effects,
        }))),
        Resolution::Global(global) => {
          todo!()
        }
        Resolution::Builtin { scheme, module } => {
          let module = match module.as_str() {
            "assert" => "assert/",
            "buffer" => "buffer/",
            "console" => "console-browserify",
            "constants" => "constants-browserify",
            "crypto" => "crypto-browserify",
            "domain" => "domain-browser",
            "events" => "events/",
            "http" => "stream-http",
            "https" => "https-browserify",
            "os" => "os-browserify",
            "path" => "path-browserify",
            "process" => "process/",
            "punycode" => "punycode/",
            "querystring" => "querystring-es3",
            "stream" => "stream-browserify",
            "string_decoder" => "string_decoder/",
            "sys" => "util",
            "timers" => "timers-browserify",
            "tty" => "tty-browserify",
            "url" => "url/",
            "util" => "util/",
            "vm" => "vm-browserify",
            "zlib" => "browserify-zlib",
            _ => todo!(),
          };

          self.resolve(dep, module, pipeline)
        }
      },
      Err(e) => {
        Err(DiagnosticList(vec![])) // TODO
      }
    }
  }
}
