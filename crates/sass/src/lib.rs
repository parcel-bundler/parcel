use std::{
  path::{Path, PathBuf},
  sync::Arc,
};

use parcel_core::{
  AssetType, BufferContent, CodeFrame, CodeHighlight, Diagnostic, ExportsCondition, FileKind,
  FileSystem, Location, PathId, SubPath, Transformer,
};
use sasso::{
  CanonicalUrl, CanonicalizeContext, Importer, ImporterError, ImporterResult, Options, Syntax,
};

pub struct SassTransformer {
  load_paths: Vec<PathId>,
}

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SassOptions {
  #[serde(default)]
  load_paths: Vec<PathBuf>,
}

impl SassTransformer {
  pub fn new(
    config: Option<serde_json::Value>,
    path: PathId,
  ) -> Result<SassTransformer, Diagnostic> {
    let options: SassOptions = match config {
      Some(config) => serde_json::from_value(config)?,
      None => Default::default(),
    };
    Ok(SassTransformer {
      load_paths: options
        .load_paths
        .into_iter()
        .map(|p| path.resolve(&p))
        .collect(),
    })
  }
}

impl Transformer for SassTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    options: &parcel_core::ParcelOptions,
    fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  ) -> Result<parcel_core::Asset, parcel_core::DiagnosticList> {
    let code = asset.content.read_string()?;
    let importer = ParcelImporter {
      fs: fs.clone(),
      load_paths: &self.load_paths,
      project_root: options.project_root,
    };
    let mut options = Options::default();
    let url = asset
      .loc
      .url
      .to_file_path()?
      .to_path_buf()
      .to_string_lossy()
      .into_owned();
    options.url = Some(&url);
    options.importer = Some(&importer);
    options.syntax = match asset.ty {
      AssetType::Sass => Syntax::Sass,
      AssetType::Scss => Syntax::Scss,
      _ => Syntax::Scss,
    };

    let result = sasso::compile_with_source_map(&code, &options).map_err(|e| Diagnostic {
      message: e.message,
      severity: parcel_core::DiagnosticSeverity::Error,
      documentation_url: None,
      hints: vec![],
      origin: Some("@parcel/transformer-sass".into()),
      code_frames: vec![CodeFrame {
        code_highlights: vec![CodeHighlight {
          message: None,
          start: Location {
            line: e.line as u32,
            column: e.col as u32,
          },
          end: Location {
            line: e.line as u32,
            column: e.col as u32,
          },
        }],
        ..Default::default()
      }],
    })?;

    asset.content = Arc::new(BufferContent::new(result.css.into_bytes()));
    asset.ty = AssetType::Css;
    Ok(asset)
  }
}

struct ParcelImporter<'a> {
  fs: Arc<dyn FileSystem>,
  load_paths: &'a Vec<PathId>,
  project_root: PathId,
}

impl<'a> Importer for ParcelImporter<'a> {
  fn canonicalize(
    &self,
    url: &str,
    ctx: &CanonicalizeContext<'_>,
  ) -> Result<Option<CanonicalUrl>, ImporterError> {
    let from = ctx
      .containing_url
      .map(|c| PathId::new(Path::new(c.as_str())))
      .unwrap_or(PathId::root());
    let base_dir = from.parent().unwrap_or(PathId::root());
    let paths = std::iter::once(base_dir).chain(self.load_paths.iter().cloned());

    // The importer should look for stylesheets by adding the prefix _ to the URL's basename,
    // and by adding the extensions .sass and .scss if the URL doesn't already have one of those extensions.
    let subpath = SubPath::new(Path::new(url));
    let mut urls = vec![SubPath::new(Path::new(url))];
    let filename = subpath.file_name();
    let parent = subpath.parent();
    if !filename.starts_with("_") {
      urls.push(parent.child(&format!("_{filename}")));
    }

    let (_, ext) = url.rsplit_once('.').unwrap_or((url, ""));
    if ext != "sass" && ext != "scss" && ext != "css" {
      let len = urls.len();
      for i in 0..len {
        urls.push(urls[i].add_extension("sass"));
        urls.push(urls[i].add_extension("scss"));
      }
    }

    // If none of the possible paths is valid, the importer should perform the same resolution on the URL followed by /index.
    urls.push(subpath.child("index.sass"));
    urls.push(subpath.child("index.scss"));
    urls.push(subpath.child("_index.sass"));
    urls.push(subpath.child("_index.scss"));

    // If the legacy webpack ~ syntax is used, treat this as a node module.
    if !url.starts_with('~') {
      for path in paths {
        for url in &urls {
          let p = path.join_subpath(&url);
          if self.fs.kind(p).contains(FileKind::IS_FILE) {
            let key = self
              .fs
              .canonicalize(p)
              .map(|c| c.to_path_buf().to_string_lossy().into_owned())
              .unwrap_or_else(|_| p.to_path_buf().to_string_lossy().into_owned());
            return Ok(Some(CanonicalUrl::new(key)));
          }
        }
      }
    }

    // If none of the default sass rules apply, try Parcel's resolver.
    // TODO: ideally this should use the configured resolver from .parcelrc.
    let mut resolver = parcel_resolver::Resolver::parcel(self.project_root);
    resolver.conditions |= ExportsCondition::SASS | ExportsCondition::STYLE;

    for url in &urls {
      let specifier = url.to_url_path();
      // Strip webpack ~ syntax (but not ~/).
      let specifier = if specifier.starts_with('~') && !specifier.starts_with("~/") {
        &specifier[1..]
      } else {
        &specifier
      };
      if let Ok(resolved) = resolver.resolve(
        specifier,
        from,
        parcel_resolver::SpecifierType::Esm,
        &*self.fs,
      ) {
        if let parcel_resolver::Resolution::Path(p) = resolved.resolution {
          let key = p.to_path_buf().to_string_lossy().into_owned();
          return Ok(Some(CanonicalUrl::new(key)));
        }
      }
    }

    Ok(None)
  }

  fn load(&self, canonical: &CanonicalUrl) -> Result<Option<ImporterResult>, ImporterError> {
    let p = PathId::new(Path::new(canonical.as_str()));
    match self.fs.read_to_string(p) {
      Ok(contents) => Ok(Some(ImporterResult {
        contents,
        syntax: syntax_for_path(p),
        source_map_url: None,
      })),
      // The file vanished between `canonicalize` and `load` -> a miss.
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
      // Any other read failure (permission, invalid UTF-8, I/O) is a real,
      // reportable error via the `ImporterError` channel, not a misleading
      // "can't find stylesheet".
      Err(e) => Err(ImporterError {
        message: format!("Cannot read {:?}: {e}", p),
      }),
    }
  }
}

fn syntax_for_path(p: PathId) -> Syntax {
  match p.extension() {
    Some(e) if e.eq_ignore_ascii_case("sass") => Syntax::Sass,
    Some(e) if e.eq_ignore_ascii_case("css") => Syntax::Css,
    _ => Syntax::Scss,
  }
}
