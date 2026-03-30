use std::{fmt::Write, path::Path, sync::Arc};

use glob_match::glob_match_with_captures;
use parcel_core::{
  AssetRequest, AssetType, BuildMode, CodeFrame, CodeHighlight, Dependency, DependencyResolution,
  Diagnostic, DiagnosticList, EnvironmentContext, ExportsCondition, Location, ParcelOptions,
  Resolver, SourceUrl, SpecifierType, glob, is_glob,
};
use parcel_resolver::{
  OsFileSystem, Resolution, ResolutionAndQuery, ResolveOptions, ResolverError, SpecifierError,
};

pub struct GlobResolver {}

impl Resolver for GlobResolver {
  fn resolve(
    &self,
    dep: &Dependency,
    specifier: &str,
    pipeline: Option<&str>,
    options: &ParcelOptions,
  ) -> Result<DependencyResolution, DiagnosticList> {
    if !is_glob(specifier) {
      return Ok(DependencyResolution::None);
    }

    let source_path = dep.resolve_from.as_ref().unwrap().to_file_path().unwrap();
    let dir = source_path.parent().unwrap();
    let files = glob(&*options.input_fs, specifier, dir)
      .into_iter()
      .filter_map(|path| pathdiff::diff_paths(&source_path, path))
      .collect::<Vec<_>>();

    let mut code = String::new();
    let mut index = 0;
    for file in &files {
      let string = file.to_str().unwrap();
      write!(&mut code, "import * as _temp{} from {:?}", index, string);
      index += 1;
    }

    code.push_str("export {");
    index = 0;
    for file in files {
      let string = file.to_str().unwrap();
      if let Some(captures) = glob_match_with_captures(specifier, string) {
        let root = &string[captures[0].clone()];
        write!(&mut code, "_temp{} as {:?}", index, root);
        index += 1;
      }
    }
    code.push_str("};\n");

    Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
      url: SourceUrl::from_path(&dir.join("glob.js")).unwrap(),
      ty: AssetType::Js,
      pipeline: None,
      env: dep.env.clone(),
      code: Some(code.into_bytes()),
      side_effects: false,
    })))
  }
}
