use either::Either;
use glob_match::glob_match;
use indexmap::IndexMap;
use serde::Deserialize;
use std::{
  ffi::OsStr,
  path::{Path, PathBuf},
  sync::Arc,
};

use crate::{
  Diagnostic, DiagnosticList, FileSystem,
  bundler::{Bundler, DefaultBundler},
  namer::Namer,
  optimizer::Optimizer,
  packager::Packager,
  resolver::Resolver,
  transformer::Transformer,
};

pub struct ParcelConfig {
  pub resolvers: Vec<Arc<dyn Resolver>>,
  pub transformers: PipelineMap<dyn Transformer>,
  pub bundler: Arc<dyn Bundler>,
  pub namers: Vec<Arc<dyn Namer>>,
  pub runtimes: Vec<Plugin<()>>,
  pub packagers: IndexMap<String, Arc<dyn Packager>>,
  pub optimizers: PipelineMap<dyn Optimizer>,
  pub compressors: PipelineMap<()>,
  pub reporters: Vec<Plugin<()>>,
  pub validators: PipelineMap<()>,
}

impl ParcelConfig {
  pub fn read(
    fs: &dyn FileSystem,
    path: &Path,
    factory: &dyn PluginFactory,
  ) -> Result<ParcelConfig, DiagnosticList> {
    let content = fs.read(path)?;
    let raw: RawParcelConfig = serde_json::from_slice(&content)?;
    raw.resolve(factory, path)
  }
}

impl Default for ParcelConfig {
  fn default() -> Self {
    ParcelConfig {
      resolvers: Default::default(),
      transformers: Default::default(),
      bundler: Arc::new(DefaultBundler {}),
      namers: Default::default(),
      runtimes: Default::default(),
      packagers: Default::default(),
      optimizers: Default::default(),
      validators: Default::default(),
      compressors: Default::default(),
      reporters: Default::default(),
    }
  }
}

pub struct PipelineMap<T: ?Sized>(pub Vec<(String, Vec<PipelineNode<T>>)>);

impl<T: ?Sized> Default for PipelineMap<T> {
  fn default() -> Self {
    PipelineMap(Vec::new())
  }
}

#[derive(Default)]
pub struct Plugin<T: ?Sized> {
  pub package_name: String,
  pub key_path: Option<String>,
  pub plugin: Arc<T>,
}

impl<T: ?Sized> Clone for Plugin<T> {
  fn clone(&self) -> Self {
    Plugin {
      package_name: self.package_name.clone(),
      key_path: self.key_path.clone(),
      plugin: self.plugin.clone(),
    }
  }
}

impl<T: ?Sized> PartialEq for Plugin<T> {
  fn eq(&self, other: &Self) -> bool {
    self.package_name == other.package_name
  }
}

pub struct JsPlugin {
  pub package_name: String,
  pub resolve_from: PathBuf,
}

impl<T> std::fmt::Debug for Plugin<T> {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.package_name.fmt(f)
  }
}

#[derive(Clone)]
pub enum PipelineNode<T: ?Sized> {
  Plugin(Arc<T>),
  Spread,
}

pub struct Pipeline<T: ?Sized>(pub Vec<Arc<T>>);

impl<T: ?Sized> PartialEq for Pipeline<T> {
  fn eq(&self, other: &Self) -> bool {
    if self.0.len() != other.0.len() {
      return false;
    }

    let mut idx = 0;
    while idx < self.0.len() {
      if !Arc::ptr_eq(&self.0[idx], &other.0[idx]) {
        return false;
      }
      idx += 1;
    }

    true
  }
}

impl<T: ?Sized> PipelineMap<T> {
  pub fn get<P: AsRef<str>>(
    &self,
    path: &str,
    pipeline: &Option<P>,
    _allow_empty: bool,
  ) -> Pipeline<T> {
    let basename = Path::new(path)
      .file_name()
      .unwrap_or_else(|| OsStr::new(path))
      .to_str()
      .unwrap();

    let mut matches = Vec::new();
    if let Some(pipeline) = pipeline {
      let exact_match = self
        .0
        .iter()
        .find(|(pattern, _)| is_match(pattern, path, basename, pipeline.as_ref()));
      if let Some((_, m)) = exact_match {
        matches.push(m);
      } else {
        return Pipeline(Vec::new());
      }
    }

    for (pattern, pipeline) in self.0.iter() {
      if is_match(pattern, path, basename, "") {
        matches.push(pipeline);
      }
    }

    if matches.is_empty() {
      return Pipeline(Vec::new());
    }

    fn flatten<T: ?Sized>(matches: &mut Vec<&Vec<PipelineNode<T>>>) -> Vec<Arc<T>> {
      if matches.is_empty() {
        return Vec::new();
      }

      matches
        .remove(0)
        .into_iter()
        .flat_map(|node| {
          match node {
            PipelineNode::Plugin(plugin) => vec![plugin.clone()],
            PipelineNode::Spread => {
              // TODO: error if more than one spread
              flatten(matches)
            }
          }
        })
        .collect()
    }

    Pipeline(flatten(&mut matches))
  }

  pub fn named_pipelines(&self) -> Vec<&str> {
    self
      .0
      .iter()
      .filter_map(|(glob, _)| glob.split_once(':').map(|g| g.0))
      .collect()
  }
}

fn is_match(pattern: &str, path: &str, basename: &str, pipeline: &str) -> bool {
  let (pattern_pipeline, glob) = pattern.split_once(':').unwrap_or(("", pattern));
  pipeline == pattern_pipeline && (glob_match(glob, basename) || glob_match(glob, path))
}

// impl Default for ParcelConfig {
//   fn default() -> Self {
//     ParcelConfig {
//       transformers: PipelineMap(indexmap! {
//         "*.{js,mjs,jsm,jsx,es6,ts,tsx}".into() => vec![PipelineNode::Plugin(PluginNode {
//           package_name: "@parcel/transformer-js".into(),
//           resolve_from: "/".into(),
//           key_path: None
//         })],
//       }),
//       resolvers: vec![],
//       bundler: PluginNode {
//         package_name: "@parcel/bundler-default".into(),
//         resolve_from: "/".into(),
//         key_path: None,
//       },
//       namers: vec![],
//       runtimes: vec![],
//       optimizers: PipelineMap(indexmap! {}),
//       packagers: indexmap! {},
//       validators: PipelineMap(indexmap! {}),
//       compressors: PipelineMap(indexmap! {}),
//       reporters: vec![],
//     }
//   }
// }

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum PluginWithConfig {
  Plugin(String),
  Config {
    plugin: String,
    config: serde_json::Value,
  },
}

impl PluginWithConfig {
  fn plugin(&self) -> &str {
    match self {
      PluginWithConfig::Plugin(p) => p,
      PluginWithConfig::Config { plugin, .. } => plugin,
    }
  }

  fn resolve<
    T: ?Sized,
    F: Fn(&str, Option<serde_json::Value>) -> Result<Arc<T>, DiagnosticList>,
    DiagnosticList,
  >(
    self,
    factory: &F,
  ) -> Result<Arc<T>, DiagnosticList> {
    match self {
      PluginWithConfig::Plugin(plugin) => factory(&plugin, None),
      PluginWithConfig::Config { plugin, config } => factory(&plugin, Some(config)),
    }
  }
}

#[derive(Deserialize)]
struct RawParcelConfig {
  extends: Option<ParcelConfigExtends>,
  resolvers: Option<RawPipeline>,
  transformers: Option<RawPipelineMap>,
  bundler: Option<PluginWithConfig>,
  namers: Option<RawPipeline>,
  runtimes: Option<RawPipeline>,
  packagers: Option<IndexMap<String, PluginWithConfig>>,
  optimizers: Option<RawPipelineMap>,
  compressors: Option<RawPipelineMap>,
  reporters: Option<RawPipeline>,
  validators: Option<RawPipelineMap>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ParcelConfigExtends {
  String(String),
  Array(Vec<String>),
}

#[derive(Default, Deserialize)]
#[serde(transparent)]
struct RawPipeline(Vec<PluginWithConfig>);

#[derive(Default, Deserialize)]
#[serde(transparent)]
struct RawPipelineMap(IndexMap<String, RawPipeline>);

pub trait PluginFactory {
  fn config(&self, specifier: &str, from: &Path) -> Result<ParcelConfig, DiagnosticList>;
  fn resolver(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: &Path,
  ) -> Result<Arc<dyn Resolver>, DiagnosticList>;
  fn transformer(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: &Path,
  ) -> Result<Arc<dyn Transformer>, DiagnosticList>;
  fn bundler(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: &Path,
  ) -> Result<Arc<dyn Bundler>, DiagnosticList>;
  fn namer(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: &Path,
  ) -> Result<Arc<dyn Namer>, DiagnosticList>;
  fn packager(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: &Path,
  ) -> Result<Arc<dyn Packager>, DiagnosticList>;
  fn optimizer(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: &Path,
  ) -> Result<Arc<dyn Optimizer>, DiagnosticList>;
}

impl RawParcelConfig {
  fn resolve(
    self,
    factory: &dyn PluginFactory,
    from: &Path,
  ) -> Result<ParcelConfig, DiagnosticList> {
    let extends = match self.extends {
      None => Vec::new(),
      Some(ParcelConfigExtends::String(e)) => vec![factory.config(&e, from)?],
      Some(ParcelConfigExtends::Array(a)) => a
        .into_iter()
        .map(|e| factory.config(&e, from))
        .collect::<Result<_, DiagnosticList>>()?,
    };

    let mut transformers = self
      .transformers
      .unwrap_or_default()
      .resolve(&|name, config| factory.transformer(name, config, from))?;

    let mut optimizers = self
      .optimizers
      .unwrap_or_default()
      .resolve(&|name, config| factory.optimizer(name, config, from))?;

    let mut extended_resolvers = Vec::new();
    let mut extended_namers = Vec::new();
    let mut extended_runtimes = Vec::new();
    let mut packagers = IndexMap::new();
    for config in extends {
      extended_resolvers.extend(config.resolvers);
      extended_namers.extend(config.namers);
      extended_runtimes.extend(config.runtimes);
      packagers.extend(config.packagers);
      transformers.0.extend(config.transformers.0);
      optimizers.0.extend(config.optimizers.0);
    }

    for (key, pkg) in self.packagers.unwrap_or_default() {
      let plugin = pkg.resolve(&|name, config| factory.packager(name, config, from))?;
      packagers.insert(key, plugin);
    }

    Ok(ParcelConfig {
      resolvers: self.resolvers.unwrap_or_default().resolve_extended(
        &|name, config| factory.resolver(name, config, from),
        extended_resolvers.into_iter(),
      )?,
      transformers,
      bundler: self
        .bundler
        .unwrap()
        .resolve(&|name, config| factory.bundler(name, config, from))?,
      namers: self.namers.unwrap_or_default().resolve_extended(
        &|name, config| factory.namer(name, config, from),
        extended_namers.into_iter(),
      )?,
      runtimes: Vec::new(),
      packagers,
      optimizers,
      validators: Default::default(),
      compressors: Default::default(),
      reporters: Default::default(),
    })
  }
}

impl RawPipeline {
  fn resolve<
    T: ?Sized,
    F: Fn(&str, Option<serde_json::Value>) -> Result<Arc<T>, DiagnosticList>,
  >(
    self,
    factory: &F,
  ) -> Result<Vec<PipelineNode<T>>, DiagnosticList> {
    self
      .0
      .into_iter()
      .map(|pkg| {
        if pkg.plugin() == "..." {
          Ok(PipelineNode::Spread)
        } else {
          Ok(PipelineNode::Plugin(pkg.resolve(factory)?))
        }
      })
      .collect()
  }

  fn resolve_extended<
    T: ?Sized,
    F: Fn(&str, Option<serde_json::Value>) -> Result<Arc<T>, DiagnosticList>,
  >(
    self,
    factory: &F,
    extends: impl Iterator<Item = Arc<T>>,
  ) -> Result<Vec<Arc<T>>, DiagnosticList> {
    let mut ext = Some(extends);
    self
      .0
      .into_iter()
      .flat_map(|pkg| {
        if pkg.plugin() == "..." {
          if let Some(ext) = std::mem::take(&mut ext) {
            Either::Left(ext.map(Ok))
          } else {
            todo!()
          }
        } else {
          Either::Right(std::iter::once(pkg.resolve(factory)))
        }
      })
      .collect()
  }
}

impl RawPipelineMap {
  fn resolve<
    T: ?Sized,
    F: Fn(&str, Option<serde_json::Value>) -> Result<Arc<T>, DiagnosticList>,
  >(
    self,
    factory: &F,
  ) -> Result<PipelineMap<T>, DiagnosticList> {
    Ok(PipelineMap(
      self
        .0
        .into_iter()
        .map(|(key, pipeline)| {
          // TODO: error on reserved named pipeline
          let pipeline = pipeline.resolve(factory)?;
          Ok((key, pipeline))
        })
        .collect::<Result<_, DiagnosticList>>()?,
    ))
  }
}
