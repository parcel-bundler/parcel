use std::{borrow::Cow, collections::BTreeMap, fmt::Write, sync::Arc};

use glob_match::glob_match_with_captures;
use parcel_core::{
  AssetRequest, AssetType, BufferContent, Dependency, DependencyResolution, DiagnosticList,
  FileSystem, OutputFormat, ParcelOptions, Resolver, SourceLocation, SourceUrl, is_glob,
};
use xxhash_rust::xxh3::xxh3_64;

pub struct GlobResolver {}

impl Resolver for GlobResolver {
  fn resolve(
    &self,
    dep: &Dependency,
    specifier: &str,
    pipeline: Option<&str>,
    _options: &ParcelOptions,
    fs: &Arc<dyn FileSystem>,
  ) -> Result<DependencyResolution, DiagnosticList> {
    let (glob, query) = specifier.split_once('?').unwrap_or((specifier, ""));
    if !is_glob(glob) {
      return Ok(DependencyResolution::None);
    }

    let mut is_async = false;
    let mut flat = false;
    for pair in query.split('&') {
      let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
      match key {
        "async" => is_async = value == "true",
        "flat" => flat = value == "true",
        _ => {}
      }
    }

    let source_path = dep.resolve_from.as_ref().unwrap().to_file_path()?;
    let dir = source_path.parent().unwrap();
    // Glob through `fs` so a new file matching the pattern triggers a rebuild (tracked as a
    // create-glob invalidation of this asset).
    let files: Vec<_> = fs
      .glob(glob, dir)
      .into_iter()
      .map(|path| path.relative(&dir))
      .collect();

    // Build the nested object tree from all wildcard captures.
    let mut root = GlobEntry::new_dir();
    for file in files.iter() {
      let rel = to_rel(file.to_str().unwrap());
      let parts: Vec<&str> = if flat {
        vec![rel.as_ref()]
      } else if let Some(captures) = glob_match_with_captures(glob, &rel) {
        // Collect all capture groups, split each on '/', discard empty segments.
        captures
          .iter()
          .flat_map(|range| rel[range.clone()].split('/'))
          .filter(|s| !s.is_empty())
          .collect()
      } else {
        vec![]
      };
      if !parts.is_empty() {
        let rel = if let Some(pipeline) = pipeline {
          format!("{}:{}", pipeline, rel)
        } else {
          rel.clone().into_owned()
        };
        root.insert(
          &parts,
          if is_async {
            GlobEntry::Import(rel)
          } else {
            GlobEntry::Require(rel)
          },
        );
      };
    }

    let output_format = dep.target.output_format;
    let mut imports = String::new();
    let mut value = String::new();
    let mut import_count = 0;
    root.write_js(&mut value, &mut imports, output_format, &mut import_count);

    let mut code = imports;
    if output_format == OutputFormat::Esmodule {
      code.push_str("export default ");
    } else {
      code.push_str("module.exports = ");
    }
    code.push_str(&value);
    code.push_str(";\n");

    let hash = format!("glob-{:016x}.js", xxh3_64(specifier.as_bytes()));
    Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
      loc: SourceLocation {
        url: SourceUrl::from_path(&dir.child(&hash)),
        ..Default::default()
      },
      ty: AssetType::Js,
      pipeline: None,
      target: dep.target.clone(),
      content: Arc::new(BufferContent::new_string(code)),
      side_effects: true,
      unique_key: None,
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

  fn write_js(
    &self,
    code: &mut String,
    imports: &mut String,
    output_format: OutputFormat,
    import_count: &mut usize,
  ) {
    match self {
      GlobEntry::Require(f) => {
        if output_format == OutputFormat::Esmodule {
          let import_id = *import_count;
          *import_count += 1;
          write!(imports, "import _glob{} from {:?};\n", import_id, f).ok();
          write!(code, "_glob{}", import_id).ok()
        } else {
          write!(
            code,
            "(function(m){{return m&&m.__esModule?m.default:m}})(require({:?}))",
            f
          )
          .ok()
        }
      }
      GlobEntry::Import(f) => write!(code, "() => import({:?})", f).ok(),
      GlobEntry::Dir(map) => {
        code.push('{');
        let mut first = true;
        for (key, value) in map {
          if !first {
            code.push_str(", ");
          }
          write!(code, "{:?}: ", key).ok();
          value.write_js(code, imports, output_format, import_count);
          first = false;
        }
        code.push('}');
        Some(())
      }
    };
  }
}
