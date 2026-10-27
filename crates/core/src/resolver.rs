use std::{path::Path, sync::Arc};

use crate::{
  CodeFrame, Dependency, DependencyFlags, DependencyResolution, Diagnostic, DiagnosticList,
  PluginContext, transformer::relative_path,
};

pub trait Resolver: Send + Sync {
  /// Resolves a dependency's specifier to a resolution.
  ///
  /// Read files through `ctx.fs` so that they are recorded as invalidations (see
  /// [`PluginContext`]). `ctx.resolve` continues with the resolvers after this one.
  fn resolve(
    &self,
    dep: &Dependency,
    specifier: &str,
    pipeline: Option<&str>,
    ctx: &PluginContext,
  ) -> Result<DependencyResolution, DiagnosticList>;
}

/// Runs `dep` through the resolvers in `ctx`, in order, until one resolves it.
pub(crate) fn resolve(
  dep: &Dependency,
  ctx: &PluginContext,
) -> Result<DependencyResolution, DiagnosticList> {
  let transformers = ctx.transformers();
  let options = ctx.options;
  let (pipeline, specifier) = if let Ok((pipeline, specifier)) = parse_pipeline(&dep.specifier) {
    // Don't consider absolute paths. Absolute paths are only supported for entries,
    // and include e.g. `C:\` on Windows, conflicting with pipelines.
    if Path::new(&*dep.specifier).is_absolute()
      || !transformers.is_some_and(|t| t.named_pipelines().any(|v| v == pipeline))
    {
      // This may be a url protocol or scheme rather than a pipeline, such as
      // `url('http://example.com/foo.png')`. Pass it to resolvers to handle.
      (None, &*dep.specifier)
    } else {
      (Some(pipeline), specifier)
    }
  } else {
    (None, &*dep.specifier)
  };

  let mut diagnostics = Vec::new();
  for (index, resolver) in ctx.resolvers().iter().enumerate() {
    match resolver.resolve(dep, specifier, pipeline, &ctx.for_resolver(index)) {
      Ok(res) => match res {
        DependencyResolution::None => continue,
        DependencyResolution::Deferred(mut req) => {
          if let Some(transformers) = transformers {
            let path = relative_path(&req.loc.url, &options.project_root, &req.ty)?;
            let pipeline = transformers
              .import_pipeline(&path, req.pipeline.clone(), dep.import_type)
              .map_err(|diagnostic| Diagnostic {
                code_frames: dep
                  .loc
                  .iter()
                  .map(|loc| CodeFrame::from_loc(loc, None))
                  .collect(),
                // A named pipeline was chosen on purpose, so a URL would not be the answer.
                hints: if req.pipeline.is_none() {
                  vec![
                    "Add a transformer for this file type to .parcelrc, or import it as a URL using the import attribute `with {type: 'url'}`.".into(),
                  ]
                } else {
                  vec![]
                },
                ..diagnostic
              })?;
            if pipeline != req.pipeline {
              Arc::make_mut(&mut req).pipeline = pipeline;
            }
          }

          return Ok(DependencyResolution::Deferred(req));
        }
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
    AssetRequest, AssetType, ExportsCondition, FileContent, FileSystem, ImportType, OsFileSystem,
    PathId, SourceLocation, SourceUrl,
  };

  use super::*;

  struct Resolver1 {}
  impl Resolver for Resolver1 {
    fn resolve(
      &self,
      _dep: &Dependency,
      specifier: &str,
      _pipeline: Option<&str>,
      _ctx: &crate::PluginContext,
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
          unique_key: None,
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
      _ctx: &crate::PluginContext,
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
          unique_key: None,
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
      // A URL, so that the empty transformer config is allowed.
      import_type: ImportType::Url,
      placeholder: None,
      resolve_from: None,
      range: None,
      conditions: ExportsCondition::empty(),
      resolution: crate::DependencyResolution::None,
      concurrent_group: 0,
      custom_conditions: Default::default(),
    };

    let fs: Arc<dyn FileSystem> = Arc::new(OsFileSystem {});
    let options = Default::default();
    let transformers = Default::default();
    let ctx = PluginContext::new(&options, &fs).with_resolvers(&resolvers, &transformers);
    let res = ctx.resolve(&dep).unwrap();
    let DependencyResolution::Deferred(req) = res else {
      panic!("expected Deferred");
    };
    assert_eq!(req.loc.url, SourceUrl::parse("file:///one.js").unwrap());
    assert_eq!(req.ty, AssetType::Js);
    assert!(!req.side_effects);

    dep.specifier = "two".into();

    let res = ctx.resolve(&dep).unwrap();
    let DependencyResolution::Deferred(req) = res else {
      panic!("expected Deferred");
    };
    assert_eq!(req.loc.url, SourceUrl::parse("file:///two.js").unwrap());
    assert_eq!(req.ty, AssetType::Js);
    assert!(!req.side_effects);
  }

  /// Resolves "delegate" by asking the context to resolve "one" instead, as a resolver plugin
  /// that wraps another would.
  struct Delegating {}
  impl Resolver for Delegating {
    fn resolve(
      &self,
      dep: &Dependency,
      specifier: &str,
      _pipeline: Option<&str>,
      ctx: &crate::PluginContext,
    ) -> Result<DependencyResolution, DiagnosticList> {
      if specifier != "delegate" && specifier != "loop" {
        return Ok(DependencyResolution::None);
      }
      let mut dep = dep.clone();
      // "loop" asks for itself again: only the resolvers after this one may see it.
      dep.specifier = if specifier == "loop" { "loop" } else { "one" }.into();
      ctx.resolve(&dep)
    }
  }

  #[test]
  fn resolvers_continue_with_the_rest_of_the_chain() {
    let resolvers: Vec<Arc<dyn Resolver>> = vec![Arc::new(Delegating {}), Arc::new(Resolver1 {})];
    let mut dep = Dependency {
      specifier: "delegate".into(),
      specifier_type: crate::SpecifierType::Esm,
      priority: crate::Priority::Sync,
      bundle_behavior: crate::BundleBehavior::None,
      flags: DependencyFlags::empty(),
      target: Arc::new(Default::default()),
      loc: None,
      // A URL, so that the empty transformer config is allowed.
      import_type: ImportType::Url,
      placeholder: None,
      resolve_from: None,
      range: None,
      conditions: ExportsCondition::empty(),
      resolution: crate::DependencyResolution::None,
      concurrent_group: 0,
      custom_conditions: Default::default(),
    };

    let fs: Arc<dyn FileSystem> = Arc::new(OsFileSystem {});
    let options = Default::default();
    let transformers = Default::default();
    let ctx = PluginContext::new(&options, &fs).with_resolvers(&resolvers, &transformers);

    let Ok(DependencyResolution::Deferred(req)) = ctx.resolve(&dep) else {
      panic!("expected Deferred");
    };
    assert_eq!(req.loc.url, SourceUrl::parse("file:///one.js").unwrap());

    // Would recurse forever if the delegating resolver saw itself again.
    dep.specifier = "loop".into();
    assert!(ctx.resolve(&dep).is_err());
  }
}
