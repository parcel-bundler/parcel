use std::{
  borrow::Cow,
  collections::HashSet,
  path::{Path, PathBuf},
};

use dashmap::DashSet;
use es_module_lexer::{lex, ImportKind};
use parcel_resolver::{
  Cache, CacheCow, FileSystem, Invalidations, OsFileSystem, Resolution, Resolver, ResolverError,
  SpecifierType,
};
use rayon::prelude::{ParallelBridge, ParallelIterator};

#[derive(Debug)]
pub enum EsmGraphBuilderError {
  IOError(std::io::Error),
  ParseError,
  ResolverError(ResolverError),
  Dynamic,
}

impl From<std::io::Error> for EsmGraphBuilderError {
  fn from(e: std::io::Error) -> Self {
    EsmGraphBuilderError::IOError(e)
  }
}

impl From<usize> for EsmGraphBuilderError {
  fn from(e: usize) -> Self {
    EsmGraphBuilderError::ParseError
  }
}

impl From<ResolverError> for EsmGraphBuilderError {
  fn from(e: ResolverError) -> Self {
    EsmGraphBuilderError::ResolverError(e)
  }
}

struct EsmGraphBuilder<'a, Fs> {
  visited: DashSet<PathBuf>,
  invalidations: Invalidations,
  resolver: &'a Resolver<'a, Fs>,
}

impl<'a, Fs: FileSystem> EsmGraphBuilder<'a, Fs> {
  pub fn build(&self, file: &Path) -> Result<(), EsmGraphBuilderError> {
    if self.visited.contains(file) {
      return Ok(());
    }

    self.visited.insert(file.to_owned());

    let contents = std::fs::read_to_string(&file)?;
    let module = lex(&contents)?;
    module
      .imports()
      .par_bridge()
      .map(|import| {
        // println!(
        //   "IMPORT {} {:?} {:?}",
        //   import.specifier(),
        //   import.kind(),
        //   file
        // );
        match import.kind() {
          ImportKind::DynamicExpression => {
            println!("DYNAMIC: {} {:?}", import.specifier(), file);
            if false {
              return Err(EsmGraphBuilderError::Dynamic);
            }
          }
          ImportKind::DynamicString | ImportKind::Standard => {
            match self.resolver.resolve_with_invalidations(
              &import.specifier(),
              &file,
              SpecifierType::Esm,
              &self.invalidations,
            ) {
              Ok((Resolution::Path(p), _)) => {
                self.invalidations.invalidate_on_file_change(&p);
                if let Some(ext) = p.extension() {
                  if ext == ".js" || ext == ".cjs" || ext == ".mjs" {
                    self.build(&p)?;
                  }
                }
              }
              Err(e) => {
                println!(
                  "FAILED TO RESOLVE {:?} {:?} {:?}",
                  import.specifier(),
                  file,
                  e
                );
              }
              _ => {}
            }
          }
          ImportKind::Meta => {}
        }

        Ok(())
      })
      .collect::<Result<_, _>>()?;

    Ok(())
  }
}

pub fn build_esm_graph<'a, Fs: FileSystem>(
  file: &Path,
  resolver: &Resolver<'a, Fs>,
) -> Result<Invalidations, EsmGraphBuilderError> {
  let mut visitor = EsmGraphBuilder {
    visited: DashSet::new(),
    invalidations: Invalidations::default(),
    resolver,
  };

  visitor.build(file)?;
  Ok(visitor.invalidations)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn root() -> PathBuf {
    // Path::new(env!("CARGO_MANIFEST_DIR"))
    //   .parent()
    //   .unwrap()
    //   .join("node-resolver-core/test/fixture")
    Path::new("/Users/devongovett/Downloads/npm-test").to_path_buf()
  }

  // #[test]
  // fn test_visitor() {
  //   let resolved = Resolver::node_esm(
  //     Cow::Owned(root()),
  //     CacheCow::Owned(Cache::new(OsFileSystem::default())),
  //   )
  //   .resolve("supports-color", &root(), SpecifierType::Esm)
  //   .result
  //   .unwrap()
  //   .0;
  //   println!("{:?}", resolved);
  //   if let Resolution::Path(p) = resolved {
  //     let res = build_esm_graph(&p, root()).unwrap();
  //     println!("{:?}", res);
  //   }
  // }
}
