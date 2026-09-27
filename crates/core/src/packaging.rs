//! Packages bundles into output content.
//!
//! Packagers embed other bundles' names (URLs, import specifiers) into their output. Once names
//! contain content hashes, a bundle's name is only known after it has been packaged, so bundles
//! are packaged in dependency order: a bundle is packaged only once every bundle it declared in
//! `Content::bundle_dependencies` has its final name. Bundles that embed each other's names in a
//! cycle are packaged with provisional names first, named together, and packaged again.

use std::{
  borrow::Cow,
  collections::HashMap,
  sync::{
    Arc, Mutex, OnceLock,
    atomic::{AtomicBool, AtomicUsize, Ordering},
  },
};

use crossbeam_channel::Sender;
use rayon::iter::{IntoParallelRefIterator, ParallelIterator};
use xxhash_rust::xxh3::Xxh3;

use crate::{
  AssetIndex, Bundle, BundleBehavior, BundleGraph, Content, Diagnostic, DiagnosticList, Optimizer,
  ParcelOptions, PathId, config::ParcelConfig,
};

/// Packaged inline bundles, keyed by bundle index and the directory the content was packaged for.
pub type InlineBundleCache = papaya::HashMap<(usize, PathId), Arc<Mutex<Option<Arc<dyn Content>>>>>;

/// The previous build's output for a bundle, keyed by its template dist path.
pub(crate) struct PrevBundle {
  /// The bundle's assets, sorted.
  pub assets: Vec<AssetIndex>,
  /// The path the bundle was written to.
  pub final_path: PathId,
  /// The hash of the content that named the bundle, if it was named by its own content.
  pub content_hash: Option<u128>,
}

/// Declares a bundle's dependencies for the duration of its packaging.
struct PackagingGuard<'a>(&'a Bundle);

impl<'a> PackagingGuard<'a> {
  fn new(bundle: &'a Bundle, declared: Vec<u64>) -> Self {
    bundle.begin_packaging(declared);
    PackagingGuard(bundle)
  }
}

impl Drop for PackagingGuard<'_> {
  fn drop(&mut self) {
    self.0.end_packaging();
  }
}

/// The optimizers that run on `bundle`, and the bundles its packager and optimizers declared.
fn packaging_plan(
  config: &ParcelConfig,
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
) -> Result<(Arc<dyn Content>, Vec<Arc<dyn Optimizer>>, Vec<usize>), DiagnosticList> {
  // Entry facades contain no modules of their own but use the entry's packager
  // to load the shared payload and execute the requested entry module.
  let first_asset = bundle
    .assets
    .first()
    .copied()
    .or(bundle.main_entry_asset)
    .ok_or_else(|| {
      Diagnostic::from_message("Cannot package a bundle with no assets".to_string())
    })?;
  let content = bundle_graph.asset_graph.asset(first_asset).content.clone();

  let mut pipeline = None;
  if let Some(main) = bundle.main_entry_asset {
    pipeline = bundle_graph.asset_graph.asset(main).pipeline.clone();
  }
  // Match optimizer globs against the dist-relative name, as they were written for bundle names
  // (e.g. "*.js"), not absolute dist paths.
  let name = bundle.dist_path.unwrap().relative(&bundle.target.dist_dir);
  let optimizers: Vec<_> = config
    .optimizers
    .get(Cow::Borrowed(name.to_str().unwrap()), &pipeline, false)
    .collect();

  let mut declared = content.bundle_dependencies(bundle_graph, bundle);
  for optimizer in &optimizers {
    declared.extend(optimizer.bundle_dependencies(bundle_graph, bundle));
  }

  Ok((content, optimizers, declared))
}

pub fn get_bundle_content(
  config: &ParcelConfig,
  bundle_graph: &BundleGraph,
  bundle_index: usize,
  options: &ParcelOptions,
  cache: &InlineBundleCache,
) -> Result<Arc<dyn Content>, DiagnosticList> {
  let bundle = &bundle_graph.bundles[bundle_index];
  package_bundle(config, bundle_graph, bundle_index, bundle, options, cache)
}

/// Packages `bundle`, which is `bundle_graph.bundles[bundle_index]`, possibly relocated to the
/// directory of the bundle it is inlined into.
fn package_bundle(
  config: &ParcelConfig,
  bundle_graph: &BundleGraph,
  bundle_index: usize,
  bundle: &Bundle,
  options: &ParcelOptions,
  cache: &InlineBundleCache,
) -> Result<Arc<dyn Content>, DiagnosticList> {
  // If this is an inline bundle, it's possible that it's inlined into many parent bundles.
  // To avoid packaging the same bundle many times, we have a cache by bundle index and directory.
  // Each entry is a Mutex<Option<dyn Content>>. The mutex is initially empty, and locked
  // while the content is packaging. If the bundle is requested a second time concurrently,
  // that thread waits on the lock and reuses the same content.
  let slot = if bundle.bundle_behavior == BundleBehavior::Inline {
    let dir = bundle
      .dist_path()
      .parent()
      .unwrap_or(bundle.target.dist_dir);
    Some(
      cache
        .pin()
        .get_or_insert_with((bundle_index, dir), || Arc::new(Mutex::new(None)))
        .clone(),
    )
  } else {
    None
  };

  // TODO: error instead of deadlocking if there is a cycle in inline bundles. Currently this cannot happen.
  let mut lock = slot.as_ref().map(|slot| slot.lock().unwrap());
  if let Some(content) = lock.as_ref().and_then(|c| (*c).as_ref()) {
    return Ok(content.clone());
  }

  let (first_content, optimizers, declared) = packaging_plan(config, bundle_graph, bundle)?;

  // Name and inline content access is checked against the declared dependencies until packaging
  // ends.
  let declared = declared
    .into_iter()
    .map(|index| bundle_graph.bundles[index].id)
    .collect();
  let _packaging = PackagingGuard::new(bundle, declared);

  let get_inline_bundle_content = |inline_index: usize| {
    let inline = &bundle_graph.bundles[inline_index];
    if !bundle.may_access(inline) {
      return Err(
        Diagnostic::from_message(format!(
          "The packager for bundle {} accessed the content of bundle {}, which it did not declare in `Content::bundle_dependencies`.",
          bundle.stable_key(),
          inline.stable_key()
        ))
        .into(),
      );
    }

    if inline.bundle_behavior != BundleBehavior::Inline {
      return get_bundle_content(config, bundle_graph, inline_index, options, cache);
    }

    // Inline content is embedded in this bundle, so relative URLs inside it must resolve from
    // this bundle's directory rather than from the inline bundle's own (never written) path.
    let dir = bundle
      .dist_path()
      .parent()
      .unwrap_or(bundle.target.dist_dir);
    let inline_path = inline.dist_path();
    if inline_path.parent() == Some(dir) {
      return package_bundle(config, bundle_graph, inline_index, inline, options, cache);
    }
    let relocated = Bundle {
      dist_path: Some(dir.child(inline_path.file_name())),
      ..inline.clone()
    };
    package_bundle(
      config,
      bundle_graph,
      inline_index,
      &relocated,
      options,
      cache,
    )
  };

  let mut content =
    first_content.package(&bundle_graph, &bundle, &get_inline_bundle_content, options)?;

  for optimizer in optimizers {
    content = optimizer.optimize(&bundle_graph, &bundle, content, options)?;
  }

  if let Some(slot) = &mut lock {
    **slot = Some(content.clone());
  }
  Ok(content)
}

/// What packaging produced, besides the content sent to be written.
pub(crate) struct Packaged {
  /// For each bundle, the hash of the content that named it, if it was named by its own content.
  pub content_hashes: Vec<Option<u128>>,
  pub stats: PackagingStats,
}

/// Counts reported after packaging.
#[derive(Debug, Default)]
pub(crate) struct PackagingStats {
  /// Bundles packaged, including second passes.
  pub packaged: AtomicUsize,
  /// Groups of bundles whose names depend on each other in a cycle.
  pub cycles: AtomicUsize,
  /// The number of bundles in the largest cycle.
  pub largest_cycle: AtomicUsize,
  /// Bundles packaged a second time, after their cycle was named.
  pub second_passes: AtomicUsize,
}

/// Whether a bundle's name contains a hash of its content, so it's only known once the bundle has
/// been packaged.
pub(crate) fn is_content_hashed(bundle: &Bundle, options: &ParcelOptions) -> bool {
  options.content_hash && bundle.may_be_content_hashed() && has_one_hash_reference(bundle)
}

/// Whether the bundle's file name contains its hash reference exactly once, so the reference can
/// be replaced by the content hash. Namers opt a bundle out of content hashing by omitting it.
fn has_one_hash_reference(bundle: &Bundle) -> bool {
  let template = bundle.dist_path.unwrap();
  template
    .file_name()
    .matches(&bundle.hash_reference())
    .count()
    == 1
}

/// The bundle's path with the hash reference in its file name replaced by `hash`, formatted as 8
/// lowercase base32 characters (40 bits). Lowercase so names can't differ only by case, which
/// would collide on case-insensitive file systems.
fn hashed_path(bundle: &Bundle, hash: u128) -> PathId {
  const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
  let hash = (0..8)
    .map(|i| ALPHABET[((hash >> (i * 5)) & 31) as usize] as char)
    .collect::<String>();
  let template = bundle.dist_path.unwrap();
  let file_name = template
    .file_name()
    .replacen(&bundle.hash_reference(), &hash, 1);
  template.parent().unwrap().child(&file_name)
}

/// Packages every bundle that is dirty, or that embeds a name which changed since the previous
/// build, in dependency order, and sends the content to be written to its final path. Every
/// pending bundle has its final path set when this returns successfully.
pub(crate) fn package_bundles(
  config: &ParcelConfig,
  bundle_graph: &BundleGraph,
  options: &ParcelOptions,
  dirty: &[bool],
  prev: &HashMap<PathId, PrevBundle>,
  sender: &Sender<(Arc<dyn Content>, PathId)>,
) -> Result<Packaged, DiagnosticList> {
  let bundles = &bundle_graph.bundles;

  // Declared dependencies of every bundle, including inline bundles.
  let declared = bundles
    .par_iter()
    .map(|bundle| packaging_plan(config, bundle_graph, bundle).map(|(_, _, declared)| declared))
    .collect::<Result<Vec<_>, _>>()?;

  // Inline bundles are packaged inside the bundles that embed them, so their dependencies are
  // their embedders' dependencies. Only pending, written bundles constrain the order.
  let pending: Vec<bool> = bundles
    .iter()
    .map(|bundle| is_content_hashed(bundle, options))
    .collect();
  let dependencies: Vec<Vec<usize>> = (0..bundles.len())
    .map(|index| {
      if bundles[index].bundle_behavior == BundleBehavior::Inline {
        return Vec::new();
      }
      let mut dependencies = Vec::new();
      let mut visited = vec![false; bundles.len()];
      let mut stack = declared[index].clone();
      while let Some(dependency) = stack.pop() {
        if std::mem::replace(&mut visited[dependency], true) {
          continue;
        }
        if bundles[dependency].bundle_behavior == BundleBehavior::Inline {
          stack.extend(&declared[dependency]);
        } else if pending[dependency] && dependency != index {
          dependencies.push(dependency);
        }
      }
      dependencies.sort_unstable();
      dependencies
    })
    .collect();

  let nodes: Vec<usize> = (0..bundles.len())
    .filter(|&index| bundles[index].bundle_behavior != BundleBehavior::Inline)
    .collect();
  let components = strongly_connected_components(&nodes, &dependencies, bundles.len());
  let mut component_of = vec![usize::MAX; bundles.len()];
  for (component, members) in components.iter().enumerate() {
    for &member in members {
      component_of[member] = component;
    }
  }

  // Each component waits on the components its members depend on.
  let mut dependents: Vec<Vec<usize>> = vec![Vec::new(); components.len()];
  let mut remaining: Vec<usize> = vec![0; components.len()];
  for (component, members) in components.iter().enumerate() {
    let mut waits_on: Vec<usize> = members
      .iter()
      .flat_map(|&member| &dependencies[member])
      .map(|&dependency| component_of[dependency])
      .filter(|&dependency| dependency != component)
      .collect();
    waits_on.sort_unstable();
    waits_on.dedup();
    remaining[component] = waits_on.len();
    for dependency in waits_on {
      dependents[dependency].push(component);
    }
  }

  // Paths are claimed as bundles are named, to catch two bundles written to the same file.
  // Bundles that aren't content hashed are written to their template path.
  let mut written_paths = HashMap::new();
  for (index, bundle) in bundles.iter().enumerate() {
    if pending[index] {
      bundle.name_state.mark_pending();
    } else if bundle.bundle_behavior != BundleBehavior::Inline {
      written_paths.insert(
        path_key(bundle.dist_path()),
        WrittenPath::Template(bundle.id),
      );
    }
  }

  let scheduler = Scheduler {
    config,
    bundle_graph,
    options,
    dirty,
    prev,
    sender,
    pending: &pending,
    dependencies: &dependencies,
    components: &components,
    dependents: &dependents,
    remaining: remaining.into_iter().map(AtomicUsize::new).collect(),
    cache: InlineBundleCache::new(),
    content_hashes: (0..bundles.len()).map(|_| OnceLock::new()).collect(),
    written_paths: Mutex::new(written_paths),
    error: Mutex::new(None),
    aborted: AtomicBool::new(false),
    stats: PackagingStats::default(),
  };

  rayon::scope(|scope| {
    for component in 0..components.len() {
      if scheduler.remaining[component].load(Ordering::Relaxed) == 0 {
        let scheduler = &scheduler;
        scope.spawn(move |scope| scheduler.run(scope, component));
      }
    }
  });

  if let Some(error) = scheduler.error.into_inner().unwrap() {
    return Err(error);
  }
  debug_assert!(
    nodes
      .iter()
      .all(|&index| !pending[index] || bundles[index].has_final_path()),
    "every pending bundle must be named after packaging"
  );
  Ok(Packaged {
    content_hashes: scheduler
      .content_hashes
      .into_iter()
      .map(|hash| hash.into_inner())
      .collect(),
    stats: scheduler.stats,
  })
}

struct Scheduler<'a, 'g> {
  config: &'a ParcelConfig,
  bundle_graph: &'a BundleGraph<'g>,
  options: &'a ParcelOptions,
  dirty: &'a [bool],
  prev: &'a HashMap<PathId, PrevBundle>,
  sender: &'a Sender<(Arc<dyn Content>, PathId)>,
  pending: &'a [bool],
  /// Pending bundles each bundle depends on, including through inline bundles.
  dependencies: &'a [Vec<usize>],
  components: &'a [Vec<usize>],
  dependents: &'a [Vec<usize>],
  /// The number of components each component still waits on.
  remaining: Vec<AtomicUsize>,
  cache: InlineBundleCache,
  /// The hash of the content that named each bundle, if it was named by its own content.
  content_hashes: Vec<OnceLock<u128>>,
  /// Written paths (see `path_key`) and what is written to each.
  written_paths: Mutex<HashMap<String, WrittenPath>>,
  error: Mutex<Option<DiagnosticList>>,
  aborted: AtomicBool,
  stats: PackagingStats,
}

impl<'a, 'g> Scheduler<'a, 'g> {
  fn run<'s>(&'s self, scope: &rayon::Scope<'s>, component: usize) {
    if self.aborted.load(Ordering::Relaxed) {
      return;
    }

    if let Err(error) = self.process(component) {
      self.aborted.store(true, Ordering::Relaxed);
      self.error.lock().unwrap().get_or_insert(error);
      return;
    }

    for &dependent in &self.dependents[component] {
      if self.remaining[dependent].fetch_sub(1, Ordering::AcqRel) == 1 {
        scope.spawn(move |scope| self.run(scope, dependent));
      }
    }
  }

  fn process(&self, component: usize) -> Result<(), DiagnosticList> {
    let members = &self.components[component];
    let bundles = &self.bundle_graph.bundles;

    // Reuse the previous output if nothing it contains could have changed.
    let needs_packaging = members.iter().any(|&member| {
      self.dirty[member]
        || self.dependencies[member]
          .iter()
          .any(|&dependency| !members.contains(&dependency) && self.name_changed(dependency))
    });
    if !needs_packaging {
      for &member in members {
        if self.pending[member] {
          let prev = &self.prev[&bundles[member].dist_path.unwrap()];
          self.claim_path(member, prev.final_path, prev.content_hash)?;
        }
      }
      return Ok(());
    }

    let is_cycle = members.len() > 1;
    if !is_cycle {
      let member = members[0];
      let content = self.package(member, &self.cache)?;
      if self.pending[member] {
        let hash = content.content_hash()?;
        let path = hashed_path(&bundles[member], hash);
        if !self.claim_path(member, path, Some(hash))? {
          return Ok(());
        }
      }
      return self.write(member, content);
    }

    self.stats.cycles.fetch_add(1, Ordering::Relaxed);
    self
      .stats
      .largest_cycle
      .fetch_max(members.len(), Ordering::Relaxed);

    // Package every member with each other's provisional names, then name them together.
    // Inline bundles are packaged separately for each pass, since they may embed members' names.
    for &member in members {
      bundles[member].name_state.mark_provisional();
    }
    let first_pass_cache = InlineBundleCache::new();
    let first_pass = members
      .par_iter()
      .map(|&member| self.package(member, &first_pass_cache))
      .collect::<Result<Vec<_>, _>>()?;

    // The first pass embeds every name outside the cycle, and members' provisional names, which
    // only depend on their ids. So together, the first pass contents of all members determine the
    // second pass contents, and one hash of them names every member.
    let mut member_hashes = members
      .iter()
      .zip(&first_pass)
      .map(|(&member, content)| Ok((bundles[member].id, content.content_hash()?)))
      .collect::<Result<Vec<_>, Diagnostic>>()?;
    member_hashes.sort_unstable();
    let mut hasher = Xxh3::new();
    for (id, hash) in &member_hashes {
      hasher.update(&id.to_le_bytes());
      hasher.update(&hash.to_le_bytes());
    }
    let cycle_hash = hasher.digest128();
    for &member in members {
      let mut hasher = Xxh3::new();
      hasher.update(&cycle_hash.to_le_bytes());
      hasher.update(&bundles[member].id.to_le_bytes());
      let path = hashed_path(&bundles[member], hasher.digest128());
      self.claim_path(member, path, None)?;
    }

    // A second pass is only needed if a member's name changed from the provisional one.
    let contents = if members
      .iter()
      .any(|&member| bundles[member].dist_path() != bundles[member].dist_path.unwrap())
    {
      self
        .stats
        .second_passes
        .fetch_add(members.len(), Ordering::Relaxed);
      let second_pass_cache = InlineBundleCache::new();
      members
        .par_iter()
        .map(|&member| self.package(member, &second_pass_cache))
        .collect::<Result<Vec<_>, _>>()?
    } else {
      first_pass
    };

    for (&member, content) in members.iter().zip(contents) {
      self.write(member, content)?;
    }
    Ok(())
  }

  /// Whether a pending bundle's final path differs from the previous build's.
  fn name_changed(&self, index: usize) -> bool {
    let bundle = &self.bundle_graph.bundles[index];
    self
      .prev
      .get(&bundle.dist_path.unwrap())
      .is_none_or(|prev| prev.final_path != bundle.dist_path())
  }

  fn package(
    &self,
    index: usize,
    cache: &InlineBundleCache,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    self.stats.packaged.fetch_add(1, Ordering::Relaxed);
    get_bundle_content(self.config, self.bundle_graph, index, self.options, cache)
  }

  /// Sets the final path of a pending bundle. `hash` is the hash of its content, if it was named
  /// by it. Bundles with identical content and names share a file, so this returns whether the
  /// bundle should write it; it's an error for a different bundle to be written to the same path.
  fn claim_path(
    &self,
    index: usize,
    path: PathId,
    hash: Option<u128>,
  ) -> Result<bool, DiagnosticList> {
    let bundle = &self.bundle_graph.bundles[index];
    bundle.set_final_path(path);
    if let Some(hash) = hash {
      self.content_hashes[index].set(hash).unwrap();
    }
    let claim = match hash {
      Some(hash) => WrittenPath::Content(hash),
      None => WrittenPath::Template(bundle.id),
    };
    let mut written_paths = self.written_paths.lock().unwrap();
    match written_paths.get(&path_key(path)) {
      None => {
        written_paths.insert(path_key(path), claim);
        Ok(true)
      }
      Some(existing) if *existing == claim && matches!(claim, WrittenPath::Content(_)) => Ok(false),
      Some(_) => Err(
        Diagnostic::from_message(format!(
          "Multiple bundles with the same name were found: {}",
          path.to_path_buf().display()
        ))
        .into(),
      ),
    }
  }

  fn write(&self, index: usize, content: Arc<dyn Content>) -> Result<(), DiagnosticList> {
    let path = self.bundle_graph.bundles[index].dist_path();
    self.sender.send((content, path)).map_err(|_| {
      DiagnosticList::from(Diagnostic::from_message(
        "Output writer pool stopped unexpectedly".into(),
      ))
    })
  }
}

/// What a bundle writes to a path.
#[derive(PartialEq)]
enum WrittenPath {
  /// A bundle named by the hash of its content. Bundles with the same content hash share it.
  Content(u128),
  /// A bundle that isn't named by its own content (a template, or a naming cycle's shared hash).
  Template(u64),
}

/// Paths compared case-insensitively, since file systems may be.
fn path_key(path: PathId) -> String {
  path.to_path_buf().to_string_lossy().to_lowercase()
}

/// Tarjan's algorithm over `nodes`, where `edges[node]` are the nodes it depends on. Returns
/// components in dependency order: every component comes after the components it depends on.
fn strongly_connected_components(
  nodes: &[usize],
  edges: &[Vec<usize>],
  node_count: usize,
) -> Vec<Vec<usize>> {
  const UNVISITED: usize = usize::MAX;
  let mut index = vec![UNVISITED; node_count];
  let mut low_link = vec![0; node_count];
  let mut on_stack = vec![false; node_count];
  let mut stack = Vec::new();
  let mut components = Vec::new();
  let mut next_index = 0;

  for &root in nodes {
    if index[root] != UNVISITED {
      continue;
    }

    // Each frame is a node and the position of the next edge to visit.
    let mut frames = vec![(root, 0)];
    index[root] = next_index;
    low_link[root] = next_index;
    next_index += 1;
    stack.push(root);
    on_stack[root] = true;

    while let Some(&mut (node, ref mut edge)) = frames.last_mut() {
      if let Some(&next) = edges[node].get(*edge) {
        *edge += 1;
        if index[next] == UNVISITED {
          index[next] = next_index;
          low_link[next] = next_index;
          next_index += 1;
          stack.push(next);
          on_stack[next] = true;
          frames.push((next, 0));
        } else if on_stack[next] {
          low_link[node] = low_link[node].min(index[next]);
        }
        continue;
      }

      frames.pop();
      if let Some(&(parent, _)) = frames.last() {
        low_link[parent] = low_link[parent].min(low_link[node]);
      }
      if low_link[node] == index[node] {
        let mut component = Vec::new();
        loop {
          let member = stack.pop().unwrap();
          on_stack[member] = false;
          component.push(member);
          if member == node {
            break;
          }
        }
        component.sort_unstable();
        components.push(component);
      }
    }
  }

  components
}

#[cfg(test)]
mod tests {
  use super::strongly_connected_components;

  fn components(edges: &[&[usize]]) -> Vec<Vec<usize>> {
    let edges: Vec<Vec<usize>> = edges.iter().map(|edges| edges.to_vec()).collect();
    let nodes: Vec<usize> = (0..edges.len()).collect();
    strongly_connected_components(&nodes, &edges, edges.len())
  }

  #[test]
  fn components_follow_dependency_order() {
    // 0 depends on 1, which depends on 2.
    assert_eq!(
      components(&[&[1], &[2], &[]]),
      vec![vec![2], vec![1], vec![0]]
    );
  }

  #[test]
  fn cycles_form_one_component() {
    // 0 depends on the cycle 1 <-> 2, which depends on 3.
    assert_eq!(
      components(&[&[1], &[2], &[1, 3], &[]]),
      vec![vec![3], vec![1, 2], vec![0]]
    );
  }

  #[test]
  fn nested_cycles_and_self_contained_nodes() {
    // 0 -> 1 -> 2 -> 0 and 2 -> 3 -> 4 -> 3, with 5 alone.
    assert_eq!(
      components(&[&[1], &[2], &[0, 3], &[4], &[3], &[]]),
      vec![vec![3, 4], vec![0, 1, 2], vec![5]]
    );
  }
}
