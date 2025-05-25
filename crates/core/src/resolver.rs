use std::path::{Path, PathBuf};

use crate::{
  CodeFrame, Dependency, DependencyFlags, Diagnostic,
  config::{JsPlugin, Plugin},
};

pub trait Resolver {
  fn resolve(
    &self,
    dep: &Dependency,
    specifier: &str,
    pipeline: Option<&str>,
  ) -> Result<ResolverResult, Vec<Diagnostic>>;
}

impl Resolver for JsPlugin {
  fn resolve(
    &self,
    dep: &Dependency,
    specifier: &str,
    pipeline: Option<&str>,
  ) -> Result<ResolverResult, Vec<Diagnostic>> {
    Err(vec![])
  }
}

#[derive(Debug, PartialEq, Clone)]
pub enum ResolverResult {
  None,
  Excluded,
  Resolved {
    path: PathBuf,
    code: Option<Vec<u8>>,
    pipeline: Option<String>,
    side_effects: bool,
    query: Option<String>,
  },
}

pub fn resolve(
  dep: &Dependency,
  resolvers: &Vec<Plugin<dyn Resolver>>,
  named_pipelines: &Vec<&str>,
) -> Result<ResolverResult, Vec<Diagnostic>> {
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
    match resolver.plugin.resolve(dep, specifier, pipeline) {
      Ok(res) => match res {
        ResolverResult::None => continue,
        _ => return Ok(res),
      },
      Err(err) => {
        diagnostics.extend(err);
        break;
      }
    }
  }

  if dep.flags.contains(DependencyFlags::OPTIONAL) {
    return Ok(ResolverResult::Excluded);
  }

  let resolve_from = dep
    .resolve_from
    .as_ref()
    .or(dep.loc.as_ref().map(|loc| &loc.file_path))
    .map(|p| format!(" from '{:?}'", p))
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

  Err(diagnostics)
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

  use super::*;

  struct Resolver1 {}
  impl Resolver for Resolver1 {
    fn resolve(
      &self,
      _dep: &Dependency,
      specifier: &str,
      _pipeline: Option<&str>,
    ) -> Result<ResolverResult, Vec<Diagnostic>> {
      if specifier == "one" {
        Ok(ResolverResult::Resolved {
          path: "one.js".into(),
          code: None,
          pipeline: None,
          side_effects: false,
          query: None,
        })
      } else {
        Ok(ResolverResult::None)
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
    ) -> Result<ResolverResult, Vec<Diagnostic>> {
      if specifier == "two" {
        Ok(ResolverResult::Resolved {
          path: "two.js".into(),
          code: None,
          pipeline: None,
          side_effects: false,
          query: None,
        })
      } else {
        Ok(ResolverResult::None)
      }
    }
  }

  #[test]
  fn test_resolve() {
    let resolvers = vec![
      Plugin::<dyn Resolver> {
        package_name: "resolver-1".into(),
        key_path: None,
        plugin: Arc::new(Resolver1 {}),
      },
      Plugin::<dyn Resolver> {
        package_name: "resolver-2".into(),
        key_path: None,
        plugin: Arc::new(Resolver2 {}),
      },
    ];

    let mut dep = Dependency {
      specifier: "one".into(),
      specifier_type: crate::SpecifierType::Esm,
      priority: crate::Priority::Sync,
      bundle_behavior: crate::BundleBehavior::None,
      flags: DependencyFlags::empty(),
      env: Arc::new(Default::default()),
      loc: Some(crate::SourceLocation {
        file_path: "test.js".into(),
        ..Default::default()
      }),
      placeholder: None,
      resolve_from: None,
      range: None,
    };

    let res = resolve(&dep, &resolvers, &Vec::new()).unwrap();
    assert_eq!(
      res,
      ResolverResult::Resolved {
        path: "one.js".into(),
        code: None,
        pipeline: None,
        side_effects: false,
        query: None
      }
    );

    dep.specifier = "two".into();

    let res = resolve(&dep, &resolvers, &Vec::new()).unwrap();
    assert_eq!(
      res,
      ResolverResult::Resolved {
        path: "two.js".into(),
        code: None,
        pipeline: None,
        side_effects: false,
        query: None
      }
    );
  }
}
