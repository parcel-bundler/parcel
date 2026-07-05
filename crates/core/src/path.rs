#![allow(dead_code)]

use std::cell::{Cell, UnsafeCell};
use std::hash::BuildHasherDefault;
use std::num::NonZeroU32;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, LazyLock};

use papaya::HashMap;
use rustc_hash::FxHasher;

static GLOBAL_INTERNER: LazyLock<PathInterner> = LazyLock::new(|| PathInterner::new());
static NODE_MODULES: LazyLock<SegmentId> =
  LazyLock::new(|| GLOBAL_INTERNER.intern_segment("node_modules"));

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct PathId(NonZeroU32);

impl PathId {
  #[inline]
  fn index(self) -> usize {
    self.0.get() as usize - 1
  }

  #[inline]
  fn from_index(index: usize) -> PathId {
    // index is always < u32::MAX in practice; +1 keeps 0 available as a niche.
    PathId(NonZeroU32::new(index as u32 + 1).unwrap())
  }

  pub fn new(path: &Path) -> PathId {
    GLOBAL_INTERNER.intern(path)
  }

  pub fn root() -> PathId {
    static ROOT: LazyLock<PathId> = LazyLock::new(|| PathId::new(Path::new("/")));
    *ROOT
  }

  pub fn child(&self, segment: &str) -> PathId {
    GLOBAL_INTERNER.child(*self, segment)
  }

  pub fn child_segment(&self, segment: SegmentId) -> PathId {
    GLOBAL_INTERNER.intern_node(Some(*self), segment)
  }

  pub fn join(&self, subpath: &Path) -> PathId {
    GLOBAL_INTERNER.join(*self, subpath)
  }

  pub fn join_subpath(&self, subpath: &SubPath) -> PathId {
    GLOBAL_INTERNER.join_subpath(*self, subpath)
  }

  pub fn resolve(&self, subpath: &Path) -> PathId {
    GLOBAL_INTERNER.resolve(*self, subpath)
  }

  pub fn join_module(&self, module: &str) -> PathId {
    GLOBAL_INTERNER.join_module(*self, module)
  }

  #[inline]
  pub fn parent(&self) -> Option<PathId> {
    GLOBAL_INTERNER.parent(*self)
  }

  pub fn file_name(&self) -> &str {
    GLOBAL_INTERNER.file_name(*self)
  }

  pub fn segment(&self) -> SegmentId {
    GLOBAL_INTERNER.node(*self).segment
  }

  pub fn file_prefix(&self) -> Option<&str> {
    let name = self.file_name();
    if name.is_empty() {
      return None;
    }
    // Mirror `std::path::Path::file_prefix`: the portion before the *first* `.`, treating a leading
    // dot as part of the name (so ".bashrc" -> ".bashrc", "foo.tar.gz" -> "foo"). Note this differs
    // from `file_stem`, which splits on the last `.`.
    let after_leading = name.strip_prefix('.').unwrap_or(name);
    let end = match after_leading.find('.') {
      Some(i) => name.len() - after_leading.len() + i,
      None => name.len(),
    };
    Some(&name[..end])
  }

  pub fn extension(&self) -> Option<&str> {
    let path = self.file_name();
    path.rsplit_once('.').map(|(_, ext)| ext)
  }

  pub fn with_extension(&self, ext: &str) -> PathId {
    let name = self.file_name();
    let (name, _) = name.rsplit_once('.').unwrap_or((name, ""));
    if ext.is_empty() {
      self.parent().unwrap().child(name)
    } else {
      SCRATCH_NAME.with(|scratch| {
        let scratch = unsafe { &mut *scratch.get() };
        scratch.clear();
        scratch.push_str(name);
        scratch.push('.');
        scratch.push_str(ext);

        self.parent().unwrap().child(&scratch)
      })
    }
  }

  pub fn add_extension(&self, ext: &str) -> PathId {
    SCRATCH_NAME.with(|scratch| {
      let scratch = unsafe { &mut *scratch.get() };
      scratch.clear();
      scratch.push_str(self.file_name());
      scratch.push('.');
      scratch.push_str(ext);

      self.parent().unwrap().child(&scratch)
    })
  }

  /// Iterates over `id` and each of its ancestors, ending at the top-level segment.
  pub fn ancestors(&self) -> Ancestors<'_> {
    GLOBAL_INTERNER.ancestors(*self)
  }

  /// Resolves `id` back to a filesystem path.
  pub fn to_path_buf(&self) -> PathBuf {
    GLOBAL_INTERNER.to_path_buf(*self)
  }

  /// Materializes this path into a thread-local scratch buffer and calls `f` with a borrowed
  /// `&Path`, avoiding the allocation of [`to_path_buf`](Self::to_path_buf). The `&Path` must not
  /// escape `f`. See [`PathInterner::with_path`].
  pub fn with_path<R, F: FnOnce(&Path) -> R>(&self, f: F) -> R {
    GLOBAL_INTERNER.with_path(*self, f)
  }

  /// Returns the relative path from `from` to this path.
  pub fn relative(&self, from: &PathId) -> PathBuf {
    GLOBAL_INTERNER.relative(*self, *from)
  }

  pub fn in_node_modules(&self) -> bool {
    self
      .ancestors()
      .any(|a| GLOBAL_INTERNER.node(a).segment == *NODE_MODULES)
  }

  pub fn is_inside(&self, parent: PathId) -> bool {
    self.ancestors().any(|a| a == parent)
  }

  pub fn ends_with(&self, subpath: &SubPath) -> bool {
    self
      .ancestors()
      .zip(subpath.0.iter().rev())
      .all(|(a, b)| GLOBAL_INTERNER.node(a).segment == *b)
  }
}

impl Default for PathId {
  fn default() -> Self {
    Self::root()
  }
}

impl std::fmt::Debug for PathId {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.to_path_buf().fmt(f)
  }
}

impl serde::Serialize for PathId {
  fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
    // Serialize as the normalized, `/`-separated path string so it is stable across platforms and
    // independent of interning order.
    GLOBAL_INTERNER.display(*self).serialize(serializer)
  }
}

impl<'de> serde::Deserialize<'de> for PathId {
  fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
    let s: &str = serde::Deserialize::deserialize(deserializer)?;
    Ok(PathId::new(Path::new(s)))
  }
}

/// Index into the interner's segment table.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SegmentId(u32);

#[derive(Clone, PartialEq, Eq, Hash)]
pub struct SubPath(smallvec::SmallVec<[SegmentId; 4]>);

impl SubPath {
  pub fn new(path: &Path) -> SubPath {
    SubPath(
      path
        .components()
        .map(|c| {
          let segment = c.as_os_str().to_string_lossy();
          GLOBAL_INTERNER.intern_segment(&segment)
        })
        .collect(),
    )
  }

  pub fn to_path_buf(&self) -> PathBuf {
    let mut buf = PathBuf::new();
    for segment in &self.0 {
      buf.push(&*GLOBAL_INTERNER.segments[segment.0 as usize]);
    }
    buf
  }

  pub fn package_json() -> &'static SubPath {
    static PACKAGE_JSON: LazyLock<SubPath> = LazyLock::new(|| SubPath::file("package.json"));
    &*PACKAGE_JSON
  }

  pub fn tsconfig_json() -> &'static SubPath {
    static TSCONFIG_JSON: LazyLock<SubPath> = LazyLock::new(|| SubPath::file("tsconfig.json"));
    &*TSCONFIG_JSON
  }

  pub fn module(name: &str) -> SubPath {
    let mut path = smallvec::smallvec![*NODE_MODULES];
    path.extend(
      name
        .split('/')
        .map(|segment| GLOBAL_INTERNER.intern_segment(segment)),
    );
    SubPath(path)
  }

  pub fn file(name: &str) -> SubPath {
    SubPath(smallvec::smallvec![GLOBAL_INTERNER.intern_segment(name)])
  }
}

impl std::fmt::Debug for SubPath {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.to_path_buf().fmt(f)
  }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
struct Node {
  /// Parent path, or `None` for a top-level segment (e.g. the filesystem root `/`).
  parent: Option<PathId>,
  /// The interned final segment of this path.
  segment: SegmentId,
}

/// Interns paths into a trie of shared components.
///
/// All methods take `&self` and are safe to call concurrently. Lookups of already-interned
/// paths/segments hit a lock-free [`papaya::HashMap`]; only first-time insertion of a new
/// segment or edge briefly takes a write lock to append to the backing tables.
pub struct PathInterner {
  /// Interns segment strings: `segment string -> SegmentId`.
  segment_ids: HashMap<Arc<str>, SegmentId, BuildHasherDefault<FxHasher>>,
  /// `SegmentId -> segment string`.
  segments: boxcar::Vec<Arc<str>>,
  /// Interns trie edges: `(parent, segment) -> PathId`.
  edge_ids: HashMap<Node, PathId, BuildHasherDefault<FxHasher>>,
  /// `PathId -> Node` (indexed by `PathId::index`).
  nodes: boxcar::Vec<Node>,
}

impl Default for PathInterner {
  fn default() -> Self {
    PathInterner::new()
  }
}

impl PathInterner {
  pub fn new() -> Self {
    PathInterner {
      segment_ids: HashMap::default(),
      segments: boxcar::Vec::new(),
      edge_ids: HashMap::default(),
      nodes: boxcar::Vec::new(),
    }
  }

  pub fn intern(&self, path: &Path) -> PathId {
    self.intern_impl(None, path)
  }

  fn intern_impl(&self, mut cur: Option<PathId>, path: &Path) -> PathId {
    for comp in path.components() {
      match comp {
        Component::CurDir => continue,
        Component::ParentDir => {
          if let Some(c) = cur {
            cur = self.node(c).parent;
          } else {
            cur = None;
          }
        }
        Component::RootDir => {
          cur = Some(self.intern_edge(None, "/"));
        }
        Component::Prefix(prefix) => {
          let s = prefix.as_os_str().to_string_lossy();
          cur = Some(self.intern_edge(cur, &s));
        }
        Component::Normal(os) => {
          let s = os.to_string_lossy();
          cur = Some(self.intern_edge(cur, &s));
        }
      }
    }
    if let Some(cur) = cur {
      cur
    } else {
      self.intern_edge(None, "/")
    }
  }

  pub fn child(&self, parent: PathId, segment: &str) -> PathId {
    self.intern_edge(Some(parent), segment)
  }

  pub fn join(&self, path: PathId, subpath: &Path) -> PathId {
    self.intern_impl(Some(path), subpath)
  }

  pub fn resolve(&self, path: PathId, subpath: &Path) -> PathId {
    self.intern_impl(self.parent(path), subpath)
  }

  pub fn join_module(&self, parent: PathId, module: &str) -> PathId {
    let mut cur = self.child(parent, "node_modules");
    for segment in module.split('/') {
      cur = self.child(cur, segment);
    }
    cur
  }

  pub fn join_subpath(&self, parent: PathId, subpath: &SubPath) -> PathId {
    let mut cur = parent;
    for segment in subpath.0.iter() {
      cur = self.intern_node(Some(cur), *segment);
    }
    cur
  }

  /// The parent of `id`, or `None` if `id` is a top-level segment.
  #[inline]
  pub fn parent(&self, id: PathId) -> Option<PathId> {
    self.node(id).parent
  }

  /// The final segment of `id` (e.g. the file name).
  pub fn file_name(&self, id: PathId) -> &str {
    let seg = self.node(id).segment;
    &self.segments[seg.0 as usize]
  }

  /// Iterates over `id` and each of its ancestors, ending at the top-level segment.
  pub fn ancestors(&self, id: PathId) -> Ancestors<'_> {
    Ancestors {
      interner: self,
      next: Some(id),
    }
  }

  /// Resolves `id` back to a filesystem path.
  pub fn to_path_buf(&self, id: PathId) -> PathBuf {
    // Collect segments from leaf to root, then reverse.
    let mut parts: Vec<&Arc<str>> = Vec::new();
    let mut cur = Some(id);
    while let Some(c) = cur {
      let node = &self.nodes[c.index()];
      parts.push(&self.segments[node.segment.0 as usize]);
      cur = node.parent;
    }

    let mut path = PathBuf::new();
    for part in parts.iter().rev() {
      path.push(part.as_ref());
    }
    path
  }

  /// Materializes `id` into a thread-local scratch buffer and calls `f` with a borrowed `&Path`,
  /// avoiding the per-call allocation of [`to_path_buf`](Self::to_path_buf).
  ///
  /// The buffer is reused across calls, so after warmup this performs no heap allocation. The
  /// `&Path` must not escape `f`. Reentrant calls on the same thread (e.g. `f` calls `with_path`
  /// again to materialize a second path at the same time) transparently fall back to a freshly
  /// allocated `PathBuf`, since a single scratch buffer can only hold one path at a time.
  pub fn with_path<R, F: FnOnce(&Path) -> R>(&self, id: PathId, f: F) -> R {
    // If the scratch buffer is already lent out on this thread, we can't reuse it without
    // clobbering the outstanding borrow, so fall back to a heap path for this (rare) nested call.
    if SCRATCH_IN_USE.with(|in_use| in_use.replace(true)) {
      return f(&self.to_path_buf(id));
    }

    // Reset the in-use flag even if `f` panics.
    struct Guard;
    impl Drop for Guard {
      fn drop(&mut self) {
        SCRATCH_IN_USE.with(|in_use| in_use.set(false));
      }
    }
    let _guard = Guard;

    SCRATCH_PATH.with(|cell| {
      // SAFETY: `SCRATCH_IN_USE` guarantees no other live borrow of this cell exists on this
      // thread for the duration of `f`, and we don't touch `path` again once `f` holds the `&Path`.
      let path = unsafe { &mut *cell.get() };
      path.clear();
      self.push_segments(path, id);
      f(path.as_path())
    })
  }

  /// Returns the relative path from `from` to `id`.
  pub fn relative(&self, id: PathId, from: PathId) -> PathBuf {
    let mut path = id;
    let mut base = from;
    let mut path_depth = self.depth(path);
    let mut base_depth = self.depth(base);
    let mut parent_dirs = 0;

    while base_depth > path_depth {
      let Some(parent) = self.parent(base) else {
        return self.to_path_buf(id);
      };
      base = parent;
      base_depth -= 1;
      parent_dirs += 1;
    }

    while path_depth > base_depth {
      let Some(parent) = self.parent(path) else {
        return self.to_path_buf(id);
      };
      path = parent;
      path_depth -= 1;
    }

    while path != base {
      let (Some(path_parent), Some(base_parent)) = (self.parent(path), self.parent(base)) else {
        return self.to_path_buf(id);
      };
      path = path_parent;
      base = base_parent;
      parent_dirs += 1;
    }

    let mut res = PathBuf::new();
    for _ in 0..parent_dirs {
      res.push(Component::ParentDir);
    }
    self.push_segments_after(&mut res, id, path);
    res
  }

  fn depth(&self, mut id: PathId) -> usize {
    let mut depth = 1;
    while let Some(parent) = self.parent(id) {
      id = parent;
      depth += 1;
    }
    depth
  }

  /// Appends `id`'s segments to `buf` in root-to-leaf order. Recurses to the parent first so the
  /// segments land in the correct order; `PathBuf::push` handles separators (and the `/` root).
  fn push_segments(&self, buf: &mut PathBuf, id: PathId) {
    let node = self.node(id);
    if let Some(parent) = node.parent {
      self.push_segments(buf, parent);
    }
    buf.push(self.segments[node.segment.0 as usize].as_ref());
  }

  fn push_segments_after(&self, buf: &mut PathBuf, id: PathId, ancestor: PathId) {
    if id == ancestor {
      return;
    }
    let parent = self
      .parent(id)
      .expect("ancestor should be in id's parent chain");
    self.push_segments_after(buf, parent, ancestor);
    buf.push(self.file_name(id));
  }

  /// Renders `id` as a normalized, `/`-separated string (stable across platforms).
  pub fn display(&self, id: PathId) -> String {
    let mut parts: Vec<&Arc<str>> = Vec::new();
    let mut cur = Some(id);
    while let Some(c) = cur {
      let node = &self.nodes[c.index()];
      parts.push(&self.segments[node.segment.0 as usize]);
      cur = node.parent;
    }

    let mut out = String::new();
    for (i, part) in parts.iter().rev().enumerate() {
      // A leading "/" segment shouldn't produce a doubled "//".
      if i > 0 && !out.ends_with('/') {
        out.push('/');
      }
      out.push_str(part);
    }
    out
  }

  // --- internals ---

  #[inline]
  fn node(&self, id: PathId) -> Node {
    self.nodes[id.index()]
  }

  fn intern_segment(&self, segment: &str) -> SegmentId {
    let segment_ids = self.segment_ids.pin();
    if let Some(id) = segment_ids.get(segment).copied() {
      return id;
    }

    // Publish atomically: under contention `get_or_insert_with` keeps a single winner and returns
    // its id to every caller. A loser may still push an (orphaned) slot to `segments`, but never
    // observes its own index, so the same string always maps to one `SegmentId`.
    let arc: Arc<str> = Arc::from(segment);
    *segment_ids.get_or_insert_with(arc.clone(), || {
      SegmentId(self.segments.push(arc.clone()) as u32)
    })
  }

  fn intern_edge(&self, parent: Option<PathId>, segment: &str) -> PathId {
    let seg = self.intern_segment(segment);
    self.intern_node(parent, seg)
  }

  fn intern_node(&self, parent: Option<PathId>, segment: SegmentId) -> PathId {
    let node = Node { parent, segment };
    let edge_ids = self.edge_ids.pin();
    *edge_ids.get_or_insert_with(node, || PathId::from_index(self.nodes.push(node)))
  }
}

thread_local! {
  static SCRATCH_PATH: UnsafeCell<PathBuf> = UnsafeCell::new(PathBuf::with_capacity(256));
  /// Whether `SCRATCH_PATH` is currently lent out on this thread (guards `with_path` reentrancy).
  static SCRATCH_IN_USE: Cell<bool> = const { Cell::new(false) };
  static SCRATCH_NAME: UnsafeCell<String> = UnsafeCell::new(String::with_capacity(64));
}

/// Iterator over a path and its ancestors. See [`PathInterner::ancestors`].
pub struct Ancestors<'a> {
  interner: &'a PathInterner,
  next: Option<PathId>,
}

impl Iterator for Ancestors<'_> {
  type Item = PathId;

  fn next(&mut self) -> Option<PathId> {
    let cur = self.next?;
    self.next = self.interner.parent(cur);
    Some(cur)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn same_path_same_id() {
    let interner = PathInterner::new();
    let a = interner.intern(Path::new("/home/user/project/src/foo.js"));
    let b = interner.intern(Path::new("/home/user/project/src/foo.js"));
    assert_eq!(a, b);
  }

  #[test]
  fn different_paths_different_ids() {
    let interner = PathInterner::new();
    let a = interner.intern(Path::new("/a/b/c"));
    let b = interner.intern(Path::new("/a/b/d"));
    assert_ne!(a, b);
  }

  #[test]
  fn shares_prefixes() {
    let interner = PathInterner::new();
    let foo = interner.intern(Path::new("/a/b/foo.js"));
    let bar = interner.intern(Path::new("/a/b/bar.js"));
    // Both descend from the same /a/b directory node.
    assert_eq!(interner.parent(foo), interner.parent(bar));
  }

  #[test]
  fn parent_and_ancestors() {
    let interner = PathInterner::new();
    let file = interner.intern(Path::new("/a/b/c.js"));
    let dir = interner.intern(Path::new("/a/b"));
    assert_eq!(interner.parent(file), Some(dir));

    let chain: Vec<String> = interner
      .ancestors(file)
      .map(|id| interner.display(id))
      .collect();
    assert_eq!(chain, vec!["/a/b/c.js", "/a/b", "/a", "/"]);
  }

  #[test]
  fn roundtrips_to_path() {
    let interner = PathInterner::new();
    let original = Path::new("/home/user/project/src/foo.js");
    let id = interner.intern(original);
    assert_eq!(interner.to_path_buf(id), original);
  }

  #[test]
  fn normalizes_dot_and_dotdot() {
    let interner = PathInterner::new();
    let a = interner.intern(Path::new("/a/b/../c/./d"));
    let b = interner.intern(Path::new("/a/c/d"));
    assert_eq!(a, b);
    assert_eq!(interner.display(a), "/a/c/d");
  }

  #[test]
  fn child_matches_intern() {
    let interner = PathInterner::new();
    let dir = interner.intern(Path::new("/a/b"));
    let viachild = interner.child(dir, "c.js");
    let viaintern = interner.intern(Path::new("/a/b/c.js"));
    assert_eq!(viachild, viaintern);
  }

  #[test]
  fn module_subpath_supports_scoped_packages() {
    let dir = PathId::new(Path::new("/a/b"));
    let via_subpath = dir.join_subpath(&SubPath::module("@scope/pkg"));
    let via_module = dir.join_module("@scope/pkg");
    assert_eq!(via_subpath, via_module);
    assert_eq!(
      via_subpath.to_path_buf(),
      Path::new("/a/b/node_modules/@scope/pkg")
    );
  }

  #[test]
  fn with_path_matches_to_path_buf() {
    let interner = PathInterner::new();
    let id = interner.intern(Path::new("/home/user/project/src/foo.js"));
    let owned = interner.to_path_buf(id);
    interner.with_path(id, |p| assert_eq!(p, owned));
    // Reuse: a second call on a different path must not be polluted by the first.
    let other = interner.intern(Path::new("/a/b"));
    interner.with_path(other, |p| assert_eq!(p, Path::new("/a/b")));
  }

  #[test]
  fn with_path_reentrant_falls_back() {
    let interner = PathInterner::new();
    let a = interner.intern(Path::new("/a/b/c.js"));
    let b = interner.intern(Path::new("/x/y/z.js"));
    // Nested materialization of a second path while the first is still borrowed: both must be
    // correct and independent (the inner call takes the heap fallback).
    interner.with_path(a, |pa| {
      interner.with_path(b, |pb| {
        assert_eq!(pa, Path::new("/a/b/c.js"));
        assert_eq!(pb, Path::new("/x/y/z.js"));
      });
      // After the nested call returns, the outer borrow must still be intact.
      assert_eq!(pa, Path::new("/a/b/c.js"));
    });
  }

  #[test]
  fn relative_path_to_child() {
    let interner = PathInterner::new();
    let from = interner.intern(Path::new("/project/src"));
    let path = interner.intern(Path::new("/project/src/foo.js"));
    assert_eq!(interner.relative(path, from), PathBuf::from("foo.js"));

    let from = PathId::new(Path::new("/project/src"));
    let path = PathId::new(Path::new("/project/src/foo.js"));
    assert_eq!(path.relative(&from), PathBuf::from("foo.js"));
  }

  #[test]
  fn relative_path_to_sibling() {
    let interner = PathInterner::new();
    let from = interner.intern(Path::new("/project/src/foo.js"));
    let path = interner.intern(Path::new("/project/src/bar.js"));
    assert_eq!(interner.relative(path, from), PathBuf::from("../bar.js"));
  }

  #[test]
  fn relative_path_to_parent() {
    let interner = PathInterner::new();
    let from = interner.intern(Path::new("/project/src/components"));
    let path = interner.intern(Path::new("/project/src"));
    assert_eq!(interner.relative(path, from), PathBuf::from(".."));
  }

  #[test]
  fn relative_path_to_divergent_path() {
    let interner = PathInterner::new();
    let from = interner.intern(Path::new("/project/src/components"));
    let path = interner.intern(Path::new("/project/assets/logo.svg"));
    assert_eq!(
      interner.relative(path, from),
      PathBuf::from("../../assets/logo.svg")
    );
  }

  #[test]
  fn relative_path_to_same_path() {
    let interner = PathInterner::new();
    let path = interner.intern(Path::new("/project/src/foo.js"));
    assert_eq!(interner.relative(path, path), PathBuf::new());
  }

  #[test]
  fn relative_path_from_root() {
    let interner = PathInterner::new();
    let from = interner.intern(Path::new("/"));
    let path = interner.intern(Path::new("/project/src/foo.js"));
    assert_eq!(
      interner.relative(path, from),
      PathBuf::from("project/src/foo.js")
    );
  }

  #[test]
  fn relative_path_to_root() {
    let interner = PathInterner::new();
    let from = interner.intern(Path::new("/project/src"));
    let path = interner.intern(Path::new("/"));
    assert_eq!(interner.relative(path, from), PathBuf::from("../.."));
  }
}
