use std::sync::Arc;

use crate::{
  Dependency, DependencyResolution, DiagnosticList, FileSystem, ParcelOptions, Resolver,
  Transformer, config::PipelineMap, resolver::resolve,
};

/// What a transformer or resolver plugin can reach while it runs.
///
/// `fs` is the per-request file system: any files a plugin reads through it (config or sidecar
/// files, `package.json`s, existence checks, globs, ...) are recorded as invalidations, so a change
/// to any of them re-runs the request. Read through `fs` rather than `options.input_fs` so this
/// tracking applies. Read an asset's own source through `asset.content`, not `fs`.
///
/// [`resolve`](Self::resolve) runs a dependency through the configured resolver plugins, the same
/// way the dependencies a transformer adds are resolved.
pub struct PluginContext<'a> {
  pub options: &'a ParcelOptions,
  pub fs: &'a Arc<dyn FileSystem>,
  /// The resolvers still available to this plugin. A resolver only sees those after itself, so
  /// that resolving from inside a resolver cannot recurse back into it.
  resolvers: &'a [Arc<dyn Resolver>],
  /// Named pipelines are recognized in specifiers (e.g. `url:./foo.png`) only when some
  /// transformer declares them.
  transformers: Option<&'a PipelineMap<dyn Transformer>>,
}

impl<'a> PluginContext<'a> {
  /// A context with no resolvers, for calling a plugin outside of a build, e.g. in tests.
  /// [`resolve`](Self::resolve) fails for every dependency.
  pub fn new(options: &'a ParcelOptions, fs: &'a Arc<dyn FileSystem>) -> Self {
    PluginContext {
      options,
      fs,
      resolvers: &[],
      transformers: None,
    }
  }

  /// Resolves through `resolvers`, recognizing the named pipelines `transformers` declares.
  pub fn with_resolvers(
    mut self,
    resolvers: &'a [Arc<dyn Resolver>],
    transformers: &'a PipelineMap<dyn Transformer>,
  ) -> Self {
    self.resolvers = resolvers;
    self.transformers = Some(transformers);
    self
  }

  /// Resolves `dep` with the configured resolver plugins.
  ///
  /// Every file probed along the way is read through [`fs`](Self::fs), so it invalidates the
  /// request the plugin is running for.
  pub fn resolve(&self, dep: &Dependency) -> Result<DependencyResolution, DiagnosticList> {
    resolve(dep, self)
  }

  pub(crate) fn resolvers(&self) -> &'a [Arc<dyn Resolver>] {
    self.resolvers
  }

  pub(crate) fn transformers(&self) -> Option<&'a PipelineMap<dyn Transformer>> {
    self.transformers
  }

  /// The context for the resolver at `index` in [`resolvers`](Self::resolvers): the same, but
  /// with only the resolvers after it.
  pub(crate) fn for_resolver(&self, index: usize) -> PluginContext<'a> {
    PluginContext {
      options: self.options,
      fs: self.fs,
      resolvers: &self.resolvers[index + 1..],
      transformers: self.transformers,
    }
  }
}
