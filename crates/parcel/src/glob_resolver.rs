use std::{borrow::Cow, collections::BTreeMap, fmt::Write, sync::Arc};

use glob_match::glob_match_with_captures;
use parcel_core::{
  AssetRequest, AssetType, BufferContent, Dependency, DependencyResolution, DiagnosticList,
  ParcelOptions, Priority, Resolver, SourceLocation, SourceUrl, glob, is_glob,
};
use xxhash_rust::xxh3::xxh3_64;

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

    let source_path = dep.resolve_from.as_ref().unwrap().to_file_path(&options.project_root)?;
    let dir = source_path.parent().unwrap();
    let files: Vec<_> = glob(&*options.input_fs, specifier, dir)
      .into_iter()
      .filter_map(|path| pathdiff::diff_paths(path, &dir))
      .collect();

    // Build the nested object tree from all wildcard captures.
    let mut root = GlobEntry::new_dir();
    for file in files.iter() {
      let rel = to_rel(file.to_str().unwrap());
      if let Some(captures) = glob_match_with_captures(specifier, &rel) {
        // Collect all capture groups, split each on '/', discard empty segments.
        let parts: Vec<&str> = captures
          .iter()
          .flat_map(|range| rel[range.clone()].split('/'))
          .filter(|s| !s.is_empty())
          .collect();
        if !parts.is_empty() {
          let rel = if let Some(pipeline) = pipeline {
            format!("{}:{}", pipeline, rel)
          } else {
            rel.clone().into_owned()
          };
          root.insert(
            &parts,
            if dep.priority == Priority::Lazy {
              GlobEntry::Import(rel)
            } else {
              GlobEntry::Require(rel)
            },
          );
        }
      }
    }

    let mut code = String::new();
    code.push_str("module.exports = ");
    root.write_js(&mut code);
    code.push_str(";\n");

    let hash = format!("glob-{:016x}.js", xxh3_64(specifier.as_bytes()));
    Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
      loc: SourceLocation {
        url: SourceUrl::from_path(&dir.join(&hash), &options.project_root)?,
        ..Default::default()
      },
      ty: AssetType::Js,
      pipeline: None,
      target: dep.target.clone(),
      content: Arc::new(BufferContent::new(code.into_bytes())),
      side_effects: true,
    })))
  }
}

fn to_rel<'a>(s: &'a str) -> Cow<'a, str> {
  if s.starts_with('.') {
    Cow::Borrowed(s)
  } else {
    Cow::Owned(format!("./{}", s))
  }
}

// Represents the nested object structure for glob exports.
enum GlobEntry {
  Require(String),
  Import(String),
  Dir(BTreeMap<String, GlobEntry>),
}

impl GlobEntry {
  fn new_dir() -> Self {
    GlobEntry::Dir(BTreeMap::new())
  }

  fn insert(&mut self, path: &[&str], entry: GlobEntry) {
    match self {
      GlobEntry::Require(_) | GlobEntry::Import(_) => {
        *self = GlobEntry::new_dir();
        self.insert(path, entry);
      }
      GlobEntry::Dir(map) => {
        if path.is_empty() {
          return;
        }
        if path.len() == 1 {
          map.insert(path[0].to_string(), entry);
        } else {
          let child = map
            .entry(path[0].to_string())
            .or_insert_with(GlobEntry::new_dir);
          child.insert(&path[1..], entry);
        }
      }
    }
  }

  fn write_js(&self, code: &mut String) {
    match self {
      GlobEntry::Require(f) => write!(code, "require({:?})", f).ok(),
      GlobEntry::Import(f) => write!(code, "() => import({:?})", f).ok(),
      GlobEntry::Dir(map) => {
        code.push('{');
        let mut first = true;
        for (key, value) in map {
          if !first {
            code.push_str(", ");
          }
          write!(code, "{:?}: ", key).ok();
          value.write_js(code);
          first = false;
        }
        code.push('}');
        Some(())
      }
    };
  }
}
