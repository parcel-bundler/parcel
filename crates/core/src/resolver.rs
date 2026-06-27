use std::{path::Path, sync::Arc};

use crate::{
  CodeFrame, Dependency, DependencyFlags, DependencyResolution, Diagnostic, DiagnosticList,
  FileSystem, ParcelOptions,
};

pub trait Resolver: Send + Sync {
  /// Resolves a dependency's specifier to a resolution.
  ///
  /// `fs` is the per-request file system: files read through it (config, `package.json`, existence
  /// checks, globs, ...) are automatically recorded as invalidations, so a change to any of them
  /// re-runs resolution. Read through `fs` rather than `options.input_fs` so this tracking applies.
  fn resolve(
    &self,
    dep: &Dependency,
    specifier: &str,
    pipeline: Option<&str>,
    options: &ParcelOptions,
    fs: &Arc<dyn FileSystem>,
  ) -> Result<DependencyResolution, DiagnosticList>;
}

pub fn resolve(
  dep: &Dependency,
  resolvers: &Vec<Arc<dyn Resolver>>,
  named_pipelines: &Vec<&str>,
  options: &ParcelOptions,
  fs: &Arc<dyn FileSystem>,
) -> Result<DependencyResolution, DiagnosticList> {
  let (pipeline, specifier) = if let Ok((pipeline, specifier)) = parse_pipeline(&dep.specifier) {
    // Don't consider absolute paths. Absolute paths are only supported for entries,
    // and include e.g. `C:\` on Windows, conflicting with pipelines.
    if Path::new(&dep.specifier).is_absolute() || !named_pipelines.contains(&pipeline) {
      // This may be a url protocol or scheme rather than a pipeline, such as
      // `url('http://example.com/foo.png')`. Pass it to resolvers to handle.
      (None, dep.specifier.as_str())
    } else {
      (Some(pipeline), specifier)
    }
  } else {
    (None, dep.specifier.as_str())
  };

  let mut diagnostics = Vec::new();
  for resolver in resolvers {
    match resolver.resolve(dep, specifier, pipeline, options, fs) {
      Ok(res) => match res {
        DependencyResolution::None => continue,
        _ => return Ok(res),
      },
      Err(err) => {
        diagnostics.extend(err.0);
        break;
      }
    }
  }

  if dep.flags.contains(DependencyFlags::OPTIONAL) {
    return Ok(DependencyResolution::Excluded);
  }

  let resolve_from = dep
    .resolve_from
    .as_ref()
    .or(dep.loc.as_ref().map(|loc| &loc.url))
    .map(|p| format!(" from '{}'", p))
    .unwrap_or_default();
  diagnostics.insert(
    0,
    Diagnostic {
      message: format!("Failed to resolve '{}'{}", specifier, resolve_from),
      origin: Some("@parcel/core".into()),
      code_frames: if let Some(loc) = &dep.loc {
        vec![CodeFrame::from_loc(loc, None)]
      } else {
        vec![]
      },
      hints: vec![],
      severity: crate::DiagnosticSeverity::Error,
      documentation_url: None,
    },
  );

  Err(DiagnosticList(diagnostics))
}

fn parse_pipeline(input: &str) -> Result<(&str, &str), ()> {
  #[inline]
  fn ascii_alpha(ch: char) -> bool {
    ch.is_ascii_alphabetic()
  }

  if input.is_empty() || !input.starts_with(ascii_alpha) {
    return Err(());
  }
  for (i, c) in input.chars().enumerate() {
    match c {
      'A'..='Z' | 'a'..='z' | '0'..='9' | '+' | '-' | '.' => {}
      ':' => {
        let scheme = &input[0..i];
        let rest = &input[i + 1..];
        return Ok((scheme, rest));
      }
      _ => {
        return Err(());
      }
    }
  }

  // EOF before ':'
  Err(())
}

#[cfg(test)]
mod tests {
  use std::sync::Arc;

  use crate::{
    AssetRequest, AssetType, ExportsCondition, FileContent, FileSystem, OsFileSystem, PathId,
    SourceLocation, SourceUrl,
  };

  use super::*;

  struct Resolver1 {}
  impl Resolver for Resolver1 {
    fn resolve(
      &self,
      _dep: &Dependency,
      specifier: &str,
      _pipeline: Option<&str>,
      _options: &ParcelOptions,
      _fs: &Arc<dyn FileSystem>,
    ) -> Result<DependencyResolution, DiagnosticList> {
      if specifier == "one" {
        Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
          loc: SourceLocation {
            url: SourceUrl::parse("file:///one.js").unwrap(),
            ..Default::default()
          },
          ty: AssetType::Js,
          content: Arc::new(FileContent::new(
            PathId::new(Path::new("one.js")),
            Arc::new(OsFileSystem {}),
          )),
          pipeline: None,
          side_effects: false,
          target: Default::default(),
        })))
      } else {
        Ok(DependencyResolution::None)
      }
    }
  }

  struct Resolver2 {}
  impl Resolver for Resolver2 {
    fn resolve(
      &self,
      _dep: &Dependency,
      specifier: &str,
      _pipeline: Option<&str>,
      _options: &ParcelOptions,
      _fs: &Arc<dyn FileSystem>,
    ) -> Result<DependencyResolution, DiagnosticList> {
      if specifier == "two" {
        Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
          loc: SourceLocation {
            url: SourceUrl::parse("file:///two.js").unwrap(),
            ..Default::default()
          },
          ty: AssetType::Js,
          content: Arc::new(FileContent::new(
            PathId::new(Path::new("two.js")),
            Arc::new(OsFileSystem {}),
          )),
          pipeline: None,
          side_effects: false,
          target: Default::default(),
        })))
      } else {
        Ok(DependencyResolution::None)
      }
    }
  }

  #[test]
  fn test_resolve() {
    let resolvers = vec![
      Arc::new(Resolver1 {}) as Arc<dyn Resolver>,
      Arc::new(Resolver2 {}),
    ];

    let mut dep = Dependency {
      specifier: "one".into(),
      specifier_type: crate::SpecifierType::Esm,
      priority: crate::Priority::Sync,
      bundle_behavior: crate::BundleBehavior::None,
      flags: DependencyFlags::empty(),
      target: Arc::new(Default::default()),
      loc: Some(crate::SourceLocation {
        url: SourceUrl::parse("file:///test.js").unwrap(),
        ..Default::default()
      }),
      placeholder: None,
      resolve_from: None,
      range: None,
      conditions: ExportsCondition::empty(),
      resolution: crate::DependencyResolution::None,
    };

    let fs: Arc<dyn FileSystem> = Arc::new(OsFileSystem {});
    let res = resolve(&dep, &resolvers, &Vec::new(), &Default::default(), &fs).unwrap();
    let DependencyResolution::Deferred(req) = res else {
      panic!("expected Deferred");
    };
    assert_eq!(req.loc.url, SourceUrl::parse("file:///one.js").unwrap());
    assert_eq!(req.ty, AssetType::Js);
    assert!(!req.side_effects);

    dep.specifier = "two".into();

    let res = resolve(&dep, &resolvers, &Vec::new(), &Default::default(), &fs).unwrap();
    let DependencyResolution::Deferred(req) = res else {
      panic!("expected Deferred");
    };
    assert_eq!(req.loc.url, SourceUrl::parse("file:///two.js").unwrap());
    assert_eq!(req.ty, AssetType::Js);
    assert!(!req.side_effects);
  }
}
