use std::path::{Path, PathBuf};

use parcel_plugin::{
  Asset, DependencyOptions, Diagnostic, ExportsConditions, FileKind, ImportType, Options, Plugin,
  ResolveResult, register_plugin,
};
use sasso::{CanonicalUrl, CanonicalizeContext, Importer, ImporterError, ImporterResult, Syntax};

pub struct SassTransformer {
  load_paths: Vec<PathBuf>,
}

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SassOptions {
  #[serde(default)]
  load_paths: Vec<PathBuf>,
}

impl Plugin for SassTransformer {
  fn new(config: &[u8]) -> Result<Self, Diagnostic> {
    let options: SassOptions = if config.is_empty() {
      Default::default()
    } else {
      serde_json::from_slice(config)
        .map_err(|err| Diagnostic::new(format!("Invalid Sass config: {err}")))?
    };
    Ok(SassTransformer {
      load_paths: options.load_paths,
    })
  }

  fn transform(&self, asset: &mut Asset, options: &Options) -> Result<(), Diagnostic> {
    let code = asset.content()?;
    // Sass works with URLs, which for files on disk are their paths.
    let file_path = asset.file_path().to_string_lossy().into_owned();

    // The plugin is not told where the config that names it lives, so relative
    // load paths are taken relative to the project root.
    let project_root = PathBuf::from(options.project_root());
    let load_paths: Vec<PathBuf> = self
      .load_paths
      .iter()
      .map(|p| project_root.join(p))
      .collect();

    let importer = ParcelImporter {
      asset,
      options,
      load_paths: &load_paths,
      entry: &file_path,
    };
    let mut sass_options = sasso::Options::default();
    sass_options.url = Some(&file_path);
    sass_options.importer = Some(&importer);
    // Imported partials are not part of any asset, so without their text the map would point
    // devtools at sources it has no content for.
    sass_options.source_map_include_sources = true;
    sass_options.syntax = match asset.asset_type().as_str() {
      "sass" => Syntax::Sass,
      _ => Syntax::Scss,
    };

    let result = sasso::compile_with_source_map(&code, &sass_options).map_err(|e| {
      Diagnostic::new(e.message)
        .with_file(file_path.clone())
        .at(e.line as u32, e.col as u32)
    })?;

    // The map's sources are the absolute paths of the stylesheet and everything it imported.
    asset.set_content_with_map(result.css, result.source_map.to_json());
    asset.set_type("css");
    Ok(())
  }
}

register_plugin!(SassTransformer);

/// Resolves and loads imports through Parcel, so every file read or probed is
/// tracked and invalidates the stylesheet when it changes, appears, or vanishes.
struct ParcelImporter<'a> {
  asset: &'a Asset<'a>,
  options: &'a Options<'a>,
  load_paths: &'a [PathBuf],
  /// The stylesheet being compiled, for imports with no containing URL.
  entry: &'a str,
}

impl<'a> Importer for ParcelImporter<'a> {
  fn canonicalize(
    &self,
    url: &str,
    ctx: &CanonicalizeContext<'_>,
  ) -> Result<Option<CanonicalUrl>, ImporterError> {
    let from = ctx.containing_url.map_or(self.entry, |c| c.as_str());
    let base_dir = Path::new(from).parent().unwrap_or(Path::new("/"));
    let urls = candidate_urls(url);

    // If the legacy webpack ~ syntax is used, treat this as a node module.
    if !url.starts_with('~') {
      let dirs = std::iter::once(base_dir).chain(self.load_paths.iter().map(PathBuf::as_path));
      for dir in dirs {
        for url in &urls {
          let path = dir.join(url);
          let Some(path) = path.to_str() else {
            continue;
          };
          if self.options.file_kind(path).contains(FileKind::FILE) {
            let key = self.options.canonicalize(path).map_or_else(
              |_| path.to_owned(),
              |path| path.to_string_lossy().into_owned(),
            );
            return Ok(Some(CanonicalUrl::new(key)));
          }
        }
      }
    }

    // If none of the default sass rules apply, try the resolvers configured in .parcelrc.
    for url in &urls {
      // Strip webpack ~ syntax (but not ~/).
      let specifier = match url.strip_prefix('~') {
        Some(rest) if !rest.starts_with('/') => rest,
        _ => url.as_str(),
      };
      let dep = DependencyOptions::new(specifier)
        .conditions(ExportsConditions::SASS | ExportsConditions::STYLE)
        // Loaded by Sass itself, so it doesn't need a transformer to become JavaScript.
        .import_type(ImportType::StyleSheet);
      if let Ok(ResolveResult::Resolved { file_path, .. }) =
        self.asset.resolve(&dep, Some(Path::new(from)))
      {
        return Ok(Some(CanonicalUrl::new(file_path.to_string_lossy())));
      }
    }

    Ok(None)
  }

  fn load(&self, canonical: &CanonicalUrl) -> Result<Option<ImporterResult>, ImporterError> {
    let path = canonical.as_str();
    match self.options.read_to_string(path) {
      Ok(contents) => Ok(Some(ImporterResult {
        contents,
        syntax: syntax_for_path(path),
        source_map_url: None,
      })),
      // The file vanished between `canonicalize` and `load` -> a miss.
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
      // Any other read failure (permission, invalid UTF-8, I/O) is a real,
      // reportable error via the `ImporterError` channel, not a misleading
      // "can't find stylesheet".
      Err(e) => Err(ImporterError {
        message: format!("Cannot read {path:?}: {e}"),
      }),
    }
  }
}

/// The paths an import URL may refer to, in the order Sass tries them.
fn candidate_urls(url: &str) -> Vec<String> {
  let (dir, filename) = match url.rfind('/') {
    Some(i) => url.split_at(i + 1),
    None => ("", url),
  };

  // The importer should look for stylesheets by adding the prefix _ to the URL's basename,
  // and by adding the extensions .sass and .scss if the URL doesn't already have one of those extensions.
  let mut urls = vec![url.to_owned()];
  if !filename.starts_with('_') {
    urls.push(format!("{dir}_{filename}"));
  }

  let ext = filename.rsplit_once('.').map_or("", |(_, ext)| ext);
  if ext != "sass" && ext != "scss" && ext != "css" {
    for i in 0..urls.len() {
      urls.push(format!("{}.sass", urls[i]));
      urls.push(format!("{}.scss", urls[i]));
    }
  }

  // If none of the possible paths is valid, the importer should perform the same resolution on the URL followed by /index.
  let base = url.trim_end_matches('/');
  for index in ["index.sass", "index.scss", "_index.sass", "_index.scss"] {
    urls.push(format!("{base}/{index}"));
  }

  urls
}

fn syntax_for_path(path: &str) -> Syntax {
  match Path::new(path).extension().and_then(|e| e.to_str()) {
    Some(e) if e.eq_ignore_ascii_case("sass") => Syntax::Sass,
    Some(e) if e.eq_ignore_ascii_case("css") => Syntax::Css,
    _ => Syntax::Scss,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn candidates_add_partials_extensions_and_index_files() {
    assert_eq!(
      candidate_urls("foo/bar"),
      [
        "foo/bar",
        "foo/_bar",
        "foo/bar.sass",
        "foo/bar.scss",
        "foo/_bar.sass",
        "foo/_bar.scss",
        "foo/bar/index.sass",
        "foo/bar/index.scss",
        "foo/bar/_index.sass",
        "foo/bar/_index.scss",
      ]
    );
  }

  #[test]
  fn candidates_keep_an_explicit_extension() {
    assert_eq!(
      candidate_urls("_vars.scss"),
      [
        "_vars.scss",
        "_vars.scss/index.sass",
        "_vars.scss/index.scss",
        "_vars.scss/_index.sass",
        "_vars.scss/_index.scss",
      ]
    );
  }
}
