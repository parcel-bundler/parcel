use std::{borrow::Cow, collections::BTreeMap, fmt::Write, sync::Arc};

use glob_match::glob_match_with_captures;
use parcel_core::{
  AssetRequest, AssetType, BufferContent, CodeFrame, Dependency, DependencyResolution, Diagnostic,
  DiagnosticList, DiagnosticSeverity, ImportType, OutputFormat, PathId, Resolver, SourceLocation,
  SourceUrl, SpecifierType, is_glob,
};
use xxhash_rust::xxh3::xxh3_64;

pub struct GlobResolver {}

impl Resolver for GlobResolver {
  fn resolve(
    &self,
    dep: &Dependency,
    specifier: &str,
    pipeline: Option<&str>,
    ctx: &parcel_core::PluginContext,
  ) -> Result<DependencyResolution, DiagnosticList> {
    let fs = ctx.fs;
    let (glob, query) = specifier.split_once('?').unwrap_or((specifier, ""));
    if !is_glob(glob) {
      return Ok(DependencyResolution::None);
    }

    // CSS `@import` rules (and JS imports with `type: 'css'`) expand to a stylesheet of `@import`
    // rules. Other URL dependencies, e.g. `url()` in CSS or `<script src>` in HTML, reference a
    // single file and can't be expanded.
    let is_css = dep.import_type == ImportType::StyleSheet;
    if !is_css && dep.specifier_type == SpecifierType::Url {
      return Err(DiagnosticList(vec![Diagnostic {
        message: "Glob imports are not supported in URL dependencies.".into(),
        origin: Some("@parcel/resolver-glob".into()),
        code_frames: dep
          .loc
          .iter()
          .map(|loc| CodeFrame::from_loc(loc, None))
          .collect(),
        hints: vec![],
        severity: DiagnosticSeverity::Error,
        documentation_url: None,
      }]));
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

    if is_css {
      let mut specifiers: Vec<String> = files
        .iter()
        .map(|file| {
          let rel = to_rel(file.to_str().unwrap());
          match pipeline {
            Some(pipeline) => format!("{}:{}", pipeline, rel),
            None => rel.into_owned(),
          }
        })
        .collect();
      specifiers.sort_unstable();
      let mut code = String::new();
      for specifier in specifiers {
        writeln!(code, "@import \"{}\";", escape_css_string(&specifier)).ok();
      }
      return Ok(deferred_asset(dep, dir, specifier, AssetType::Css, code));
    }

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

    Ok(deferred_asset(dep, dir, specifier, AssetType::Js, code))
  }
}

fn deferred_asset(
  dep: &Dependency,
  dir: PathId,
  specifier: &str,
  ty: AssetType,
  code: String,
) -> DependencyResolution {
  let name = format!(
    "glob-{:016x}.{}",
    xxh3_64(specifier.as_bytes()),
    ty.extension()
  );
  DependencyResolution::Deferred(Arc::new(AssetRequest {
    loc: SourceLocation {
      url: SourceUrl::from_path(&dir.child(&name)),
      ..Default::default()
    },
    ty,
    pipeline: None,
    target: dep.target.clone(),
    content: Arc::new(BufferContent::new_string(code)),
    side_effects: true,
    unique_key: None,
  }))
}

fn escape_css_string(s: &str) -> Cow<'_, str> {
  if s.contains(['"', '\\', '\n']) {
    Cow::Owned(
      s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\a "),
    )
  } else {
    Cow::Borrowed(s)
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
