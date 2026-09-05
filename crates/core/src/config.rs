use either::Either;
use glob_match::glob_match;
use indexmap::IndexMap;
use serde::Deserialize;
use std::{borrow::Cow, collections::HashSet, ffi::OsStr, path::Path, slice, sync::Arc};

use crate::{
  Diagnostic, DiagnosticList, FileSystem, PathId, bundler::Bundler, namer::Namer,
  optimizer::Optimizer, reporter::Reporter, resolver::Resolver, transformer::Transformer,
};

pub struct ParcelConfig {
  pub resolvers: Vec<Arc<dyn Resolver>>,
  pub transformers: PipelineMap<dyn Transformer>,
  pub bundler: Arc<dyn Bundler>,
  pub namers: Vec<Arc<dyn Namer>>,
  pub optimizers: PipelineMap<dyn Optimizer>,
  pub compressors: PipelineMap<()>,
  pub reporters: Vec<Arc<dyn Reporter>>,
}

impl ParcelConfig {
  pub fn read(
    fs: &dyn FileSystem,
    path: PathId,
    factory: &dyn PluginFactory,
  ) -> Result<ParcelConfig, DiagnosticList> {
    let content = fs.read(path)?;
    Self::from_json(path, &content, factory)
  }

  pub fn from_json(
    path: PathId,
    json: &[u8],
    factory: &dyn PluginFactory,
  ) -> Result<ParcelConfig, DiagnosticList> {
    let raw: RawParcelConfig = serde_json::from_slice(json)?;
    raw.resolve(factory, path)
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

impl<T: ?Sized> PipelineMap<T> {
  pub fn get<'a, P: AsRef<str>>(
    &'a self,
    path: Cow<'a, str>,
    pipeline: &Option<P>,
    _allow_empty: bool,
  ) -> Pipeline<'a, T> {
    let basename = Path::new(&*path)
      .file_name()
      .unwrap_or_else(|| OsStr::new(&*path))
      .to_str()
      .unwrap()
      .to_owned();

    let current = pipeline.as_ref().and_then(|pipeline| {
      self
        .0
        .iter()
        .find(|(pattern, _)| is_match(pattern, &path, &basename, pipeline.as_ref()))
        .map(|(_, pipeline)| pipeline.iter())
    });

    Pipeline {
      pipelines: &self.0,
      path,
      basename: basename,
      // A missing named pipeline must not fall back to a default pipeline.
      pipeline_index: if pipeline.is_some() && current.is_none() {
        self.0.len()
      } else {
        0
      },
      current,
      stack: Vec::new(),
      seen: HashSet::new(),
    }
  }

  pub fn named_pipelines(&self) -> impl Iterator<Item = &str> {
    self
      .0
      .iter()
      .filter_map(|(glob, _)| glob.split_once(':').map(|g| g.0))
  }
}

fn is_match(pattern: &str, path: &str, basename: &str, pipeline: &str) -> bool {
  let (pattern_pipeline, glob) = pattern.split_once(':').unwrap_or(("", pattern));
  pipeline == pattern_pipeline && (glob_match(glob, basename) || glob_match(glob, path))
}

pub struct Pipeline<'a, T: ?Sized> {
  pipelines: &'a [(String, Vec<PipelineNode<T>>)],
  pipeline_index: usize,
  path: Cow<'a, str>,
  basename: String,
  current: Option<slice::Iter<'a, PipelineNode<T>>>,
  stack: Vec<slice::Iter<'a, PipelineNode<T>>>,
  seen: HashSet<*const T>,
}

impl<'a, T: ?Sized> Pipeline<'a, T> {
  pub fn change_type(&mut self, path: String, pipeline: &mut Option<hstr::Atom>) {
    self.basename = Path::new(&path)
      .file_name()
      .unwrap_or_else(|| OsStr::new(&path))
      .to_str()
      .unwrap()
      .to_owned();
    self.path = Cow::Owned(path);

    self.stack.clear();
    self.current = pipeline.as_ref().and_then(|pipeline| {
      self
        .pipelines
        .iter()
        .find(|(pattern, _)| is_match(pattern, &self.path, &self.basename, pipeline.as_ref()))
        .map(|(_, pipeline)| pipeline.iter())
    });

    // For type changes, we do fall back to a default pipeline if a named pipeline does not exist.
    self.pipeline_index = 0;
    if pipeline.is_some() && self.current.is_none() {
      *pipeline = None;
    }
  }

  fn next_pipeline(&mut self) -> Option<&'a [PipelineNode<T>]> {
    while let Some((pattern, pipeline)) = self.pipelines.get(self.pipeline_index) {
      self.pipeline_index += 1;
      if is_match(pattern, &self.path, &self.basename, "") {
        return Some(pipeline);
      }
    }

    None
  }
}

impl<T: ?Sized> Iterator for Pipeline<'_, T> {
  type Item = Arc<T>;

  fn next(&mut self) -> Option<Self::Item> {
    loop {
      if self.current.is_none() {
        self.current = Some(self.next_pipeline()?.iter());
      }

      match self.current.as_mut().unwrap().next() {
        Some(PipelineNode::Plugin(plugin)) => {
          if self.seen.insert(Arc::as_ptr(plugin)) {
            return Some(plugin.clone());
          }
        }
        Some(PipelineNode::Spread) => {
          if let Some(pipeline) = self.next_pipeline() {
            self.stack.push(self.current.take().unwrap());
            self.current = Some(pipeline.iter());
          }
        }
        None => {
          if let Some(parent) = self.stack.pop() {
            self.current = Some(parent);
          } else {
            return None;
          }
        }
      }
    }
  }
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
  optimizers: Option<RawPipelineMap>,
  compressors: Option<RawPipelineMap>,
  reporters: Option<RawPipeline>,
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
  fn config(&self, specifier: &str, from: PathId) -> Result<ParcelConfig, DiagnosticList>;
  fn resolver(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: PathId,
  ) -> Result<Arc<dyn Resolver>, DiagnosticList>;
  fn transformer(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: PathId,
  ) -> Result<Arc<dyn Transformer>, DiagnosticList>;
  fn bundler(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: PathId,
  ) -> Result<Arc<dyn Bundler>, DiagnosticList>;
  fn namer(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: PathId,
  ) -> Result<Arc<dyn Namer>, DiagnosticList>;
  fn optimizer(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: PathId,
  ) -> Result<Arc<dyn Optimizer>, DiagnosticList>;
  fn reporter(
    &self,
    name: &str,
    config: Option<serde_json::Value>,
    from: PathId,
  ) -> Result<Arc<dyn Reporter>, DiagnosticList>;
}

impl RawParcelConfig {
  fn resolve(
    self,
    factory: &dyn PluginFactory,
    from: PathId,
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

    let bundler = if let Some(bundler) = self.bundler {
      Some(bundler.resolve(&|name, config| factory.bundler(name, config, from))?)
    } else {
      extends.get(0).map(|e| e.bundler.clone())
    }
    .ok_or_else(|| Diagnostic::from_message("Config does not have a bundler".into()))?;

    let mut extended_resolvers = Vec::new();
    let mut extended_namers = Vec::new();
    let mut extended_reporters = Vec::new();
    for config in extends {
      extended_resolvers.extend(config.resolvers);
      extended_namers.extend(config.namers);
      extended_reporters.extend(config.reporters);
      transformers.0.extend(config.transformers.0);
      optimizers.0.extend(config.optimizers.0);
    }

    Ok(ParcelConfig {
      resolvers: self.resolvers.unwrap_or_default().resolve_extended(
        &|name, config| factory.resolver(name, config, from),
        extended_resolvers.into_iter(),
      )?,
      transformers,
      bundler: bundler,
      namers: self.namers.unwrap_or_default().resolve_extended(
        &|name, config| factory.namer(name, config, from),
        extended_namers.into_iter(),
      )?,
      optimizers,
      compressors: Default::default(),
      reporters: self.reporters.unwrap_or_default().resolve_extended(
        &|name, config| factory.reporter(name, config, from),
        extended_reporters.into_iter(),
      )?,
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
    if self.0.is_empty() {
      return Ok(extends.collect());
    }

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

#[cfg(test)]
mod tests {
  use super::*;

  fn plugin(name: &str) -> PipelineNode<str> {
    PipelineNode::Plugin(Arc::from(name))
  }

  fn names(pipeline: Pipeline<'_, str>) -> Vec<String> {
    pipeline.map(|plugin| plugin.to_string()).collect()
  }

  #[test]
  fn recursively_expands_matching_pipelines_at_spreads() {
    let pipelines = PipelineMap(vec![
      (
        "*.js".into(),
        vec![plugin("first"), PipelineNode::Spread, plugin("last")],
      ),
      (
        "*.js".into(),
        vec![plugin("second"), PipelineNode::Spread, plugin("fourth")],
      ),
      ("src/*.js".into(), vec![plugin("third")]),
    ]);

    assert_eq!(
      names(pipelines.get::<&str>("src/app.js".into(), &None, false)),
      ["first", "second", "third", "fourth", "last"]
    );
  }

  #[test]
  fn expands_defaults_from_a_named_pipeline() {
    let pipelines = PipelineMap(vec![
      (
        "custom:*.js".into(),
        vec![plugin("named"), PipelineNode::Spread],
      ),
      ("*.js".into(), vec![plugin("default")]),
    ]);

    assert_eq!(
      names(pipelines.get("app.js".into(), &Some("custom"), false)),
      ["named", "default"]
    );
    assert!(
      pipelines
        .get("app.js".into(), &Some("missing"), false)
        .next()
        .is_none()
    );
  }

  #[test]
  fn change_type_continues_after_seen_plugins() {
    let pipelines = PipelineMap(vec![(
      "*.{js,css}".into(),
      vec![plugin("type-changer"), plugin("after")],
    )]);
    let mut pipeline = pipelines.get::<&str>("app.js".into(), &None, false);

    assert_eq!(pipeline.next().unwrap().as_ref(), "type-changer");
    pipeline.change_type("app.css".into(), &mut None);

    assert_eq!(names(pipeline), ["after"]);
  }

  #[test]
  fn change_type_preserves_the_first_named_plugin() {
    let pipelines = PipelineMap(vec![
      (
        "custom:*.css".into(),
        vec![plugin("named-first"), plugin("named-second")],
      ),
      ("*.js".into(), vec![plugin("type-changer")]),
      ("*.css".into(), vec![plugin("default")]),
    ]);
    let mut pipeline = pipelines.get::<&str>("app.js".into(), &None, false);
    pipeline.next();

    let mut named_pipeline = Some(hstr::Atom::from("custom"));
    pipeline.change_type("app.css".into(), &mut named_pipeline);

    assert_eq!(names(pipeline), ["named-first", "named-second"]);
  }

  #[test]
  fn change_type_falls_back_when_named_pipeline_is_missing() {
    let pipelines = PipelineMap(vec![
      ("*.js".into(), vec![plugin("type-changer")]),
      ("*.css".into(), vec![plugin("default")]),
    ]);
    let mut pipeline = pipelines.get::<&str>("app.js".into(), &None, false);
    pipeline.next();

    let mut named_pipeline = Some(hstr::Atom::from("missing"));
    pipeline.change_type("app.css".into(), &mut named_pipeline);

    assert!(named_pipeline.is_none());
    assert_eq!(names(pipeline), ["default"]);
  }
}
