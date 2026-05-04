use std::{fmt::Write, sync::Arc};

use glob_match::glob_match_with_captures;
use parcel_core::{
  AssetRequest, AssetType, Dependency, DependencyResolution, DiagnosticList, ParcelOptions,
  Resolver, SourceUrl, glob, is_glob,
};
use xxhash_rust::xxh3::xxh3_64;

pub struct GlobResolver {}

impl Resolver for GlobResolver {
  fn resolve(
    &self,
    dep: &Dependency,
    specifier: &str,
    _pipeline: Option<&str>,
    options: &ParcelOptions,
  ) -> Result<DependencyResolution, DiagnosticList> {
    if !is_glob(specifier) {
      return Ok(DependencyResolution::None);
    }

    let source_path = dep.resolve_from.as_ref().unwrap().to_file_path().unwrap();
    let dir = source_path.parent().unwrap();
    let files = glob(&*options.input_fs, specifier, dir)
      .into_iter()
      .filter_map(|path| pathdiff::diff_paths(path, &dir))
      .collect::<Vec<_>>();

    let mut code = String::new();
    let mut index = 0;
    for file in &files {
      let string = file.to_str().unwrap();
      write!(&mut code, "import _temp{} from {:?};\n", index, string);
      index += 1;
    }

    code.push_str("export default {");
    index = 0;
    for file in files {
      let string = file.to_str().unwrap();
      if let Some(captures) = glob_match_with_captures(specifier, string) {
        let root = &string[captures[0].clone()];
        write!(&mut code, "{:?}: _temp{}, ", root, index);
        index += 1;
      }
    }
    code.push_str("};\n");

    let hash = format!("glob-{:016x}.js", xxh3_64(specifier.as_bytes()));
    Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
      url: SourceUrl::from_path(&dir.join(&hash)).unwrap(),
      ty: AssetType::Js,
      pipeline: None,
      target: dep.target.clone(),
      code: Some(code.into_bytes()),
      side_effects: true,
    })))
  }
}
