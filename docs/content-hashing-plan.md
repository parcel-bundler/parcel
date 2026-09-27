# Content hashing for Parcel v3: implementation plan

Status: proposed · Branch: `v3-content-hashing` · Base: `core-rs3` @ `8bb32a53a`

## Goal

Put a hash of each bundle's final bytes in the file name of every non-stable bundle, so outputs can
be served with immutable long-term cache headers. Requirements:

- Correct for every language that embeds references (JS, CSS, HTML, SVG, RSC manifests), for inline
  bundles (including base64 data URLs), and for any optimizer, first- or third-party.
- Source maps are always correct.
- There are no text sentinels to search for, so escaping, minifiers and encodings cannot break the
  scheme.
- Invalidation cascades as little as possible: changing one module renames that bundle, plus
  only the bundles that literally embed its name.
- Incremental rebuilds re-package only what actually changed.

## Chosen approach (summary)

1. **Package in dependency order, with final names.** A bundle is packaged only after every bundle
   whose _final name_ it embeds has been hashed and named. Its hash is then a plain hash of its
   final output bytes. There are no placeholders to replace, and nothing to scan for or remap. Every
   optimizer and encoding just works, and source maps are generated from final text.
2. **Two passes only for cycles.** When bundles embed each other's names in a cycle, each member
   is packaged once with provisional (template) names. One composite hash is taken over the
   pass-1 outputs, and the members are packaged again with the final names.
3. **Declare bundle dependencies up front, as a contract.** Before packaging, each content type
   declares which bundles' names (and which inline bundles' contents) it will access. That list
   drives ordering, cycle detection and incremental invalidation. Name accessors enforce it: reading
   the name of a bundle that wasn't declared is an error, not a silently wrong name.
4. **Route most references through stable keys, not final names.** JS loads bundles through the
   runtime (`loadJS`, `loadCSS`, `resolve`) using a _stable key_ (the template name). A manifest
   mapping `stable key → final URL` is held once, at the top of each execution context: inline in the
   HTML page, in a stable-named entry, or in a worker entry. Hashed chunks never embed other chunks'
   final names, so there is no cascade between chunks.

The research behind this choice (Rollup, Rolldown, esbuild, webpack, Turbopack, Vite, Farm) is in
the session notes. In short:

- Sentinel replacement (v2, Rollup) breaks under escaping and under anything that rewrites text.
- Content changed after hashing (Vite's `__vite__mapDeps`, Rollup's sourcemap comment) produces the
  same name for different bytes.
- Chunk-to-chunk URLs cascade, whereas a manifest or import map held at the root does not.

## Core invariant

> A hashed bundle's output bytes are a deterministic function of (its inputs, the final names it read).
> Its hash covers exactly those bytes plus (for cycle members) the pass-1 composite. Nothing
> modifies a bundle's bytes after its hash is computed.

Every step below exists to uphold this. `debug_assertions` builds check it (see Testing).

---

## Current state (what we're changing)

| Area             | Today                                                                                                                                                                                                       | Location                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Naming           | Namer runs once, right after bundling, and sets `dist_path`. Non-stable names are `{stem}-{bundle.id:016x}.{ext}`. `bundle.id` is structural (asset identity), not content.                                 | `crates/core/src/bundler.rs:26-34`, `crates/parcel/src/namer.rs:116-123`             |
| Name access      | Packagers call `Bundle::relative_url(from)`, `relative_specifier(from)`, `name()`, `absolute_url()`. There is no tracking.                                                                                  | `crates/core/src/bundle.rs:44-79`; ~30 call sites (JS, CSS, HTML, RSC, library, HMR) |
| Packaging        | Flat `par_iter` over dirty bundles. Inline bundles are packaged on demand and cached. Optimizers run inside `get_bundle_content`.                                                                           | `crates/core/src/lib.rs:386-654`                                                     |
| Incremental      | `prev_bundles` is keyed by dist path. **If any output path changes, every bundle is re-packaged.**                                                                                                          | `lib.rs:401-476`                                                                     |
| Runtime manifest | `runtime.js` resolves through `importMap[id] \|\| id` and exposes `extendImportMap`, but **nothing fills it**.                                                                                              | `crates/js/src/runtime.js:85-146`                                                    |
| Cross-chunk JS   | `write_bundle_references` emits a static `import "./x.js"` in every bundle with `referenced_bundles` (entries, lazy, shared, worker). The async shim loads only _direct_ references (`// TODO: recursive`). | `crates/js/src/packager/mod.rs:304-325`, `synthetic.rs:270-314`                      |
| Content hash     | None exists. `Content::hash` has no callers, and `FileContent::hash` hashes the _path_.                                                                                                                     | `crates/core/src/content.rs:71-74,191-193`                                           |
| Options          | No `content_hash` option or flag.                                                                                                                                                                           | `crates/core/src/options.rs`, `crates/parcel/src/main.rs`                            |
| Source maps      | `<path>.map` is written beside the bundle. No `sourceMappingURL` comment is emitted.                                                                                                                        | `content.rs:315-319`                                                                 |

Pre-existing bugs found while mapping this (fixed in Phase 0):

1. **HTML embeds a URL to an inline bundle.** `prepare_to_package` checks only
   `dep.bundle_behavior == Inline`, not the target's behavior. So `<img src="data-url:./x.svg">`
   gets the relative URL of a bundle that is never written. CSS checks both. (`crates/html/src/lib.rs:477-483`)
2. **`loadCSS` uses a path relative to the importing bundle** (`'./' + relative_url(from)`), but
   `link.href` resolves against the _document_. This breaks when the bundle and the page are in
   different directories. (`synthetic.rs:331-347`, `runtime.js:96-137`)
3. **Service workers are not stable-named.** Today they get `sw-<id>.js`, which only works because
   ids are structural. With content hashing, the registration URL would change on every edit.
   (`crates/js/src/transformer.rs:303-312`: no `NEEDS_STABLE_NAME`)
4. **Inline CSS (a `<style>` bundle or a style attribute) computes `url()` values relative to the
   inline bundle's own `dist_path`**, not the HTML page that embeds it. Probably wrong for pages in
   subdirectories. _Needs a repro first._ (`crates/css/src/packager.rs:1181`)
5. **The async shim loads only direct `referenced_bundles` of a lazy bundle**, not the transitive
   closure. Today this is hidden by the lazy bundle's own static imports, which Phase 4 removes.

---

## Design

### D1. Name access and the dependency contract

**Two kinds of name access.**

- **Stable key**: `Bundle::stable_key() -> String`. The dist-root-relative _template_ name, e.g.
  `client/button-3fa9c1e28b7d0a44.js`.
  - It never changes with content, and reading it is not a name dependency.
  - It's used wherever the runtime resolves through the manifest:
    - `loadJS`, `loadCSS` and `resolve` (URL deps, workers, `new URL`);
    - RSC client-reference bundle lists;
    - server-action bundle lists.
  - With hashing off, stable key == final name and the manifest is empty. The runtime's
    `importMap[id] || id` fallback makes that a no-op, so dev output is unchanged.
- **Final name**: the existing `Bundle` API keeps its shape.
  - `relative_url(from)`, `relative_specifier(from)`, `absolute_url()`, `name()`, `dist_path()`.
  - Each returns the final path once it's set, otherwise the template.
  - Reporters, tests and `run` read final names with no write-back step.

**State on `Bundle`** (no side table):

```rust
final_path: OnceLock<PathId>,   // set once by the scheduler, when the bundle is final
declared: DeclaredDeps,         // Mutex<Option<Box<[u64]>>>: sorted ids; Some only while packaging
```

- `dist_path` stays the namer's template.
- A manual `Clone` copies `final_path` and resets `declared`. (Phase 0's relocated inline clones
  get their own declaration from core.)
- Targets are identified by `bundle.id`, not index, because the bundle optimizer reorders
  indices. Ids must be unique, which a debug assertion checks.

**The contract:**

```rust
trait Content {
  /// Bundles whose final names `package` (or an optimizer) may read for `bundle`, plus inline
  /// bundles whose content it embeds. Called before packaging. May over-approximate, but reading
  /// anything not listed is an error.
  fn bundle_dependencies(&self, graph: &BundleGraph, bundle: &Bundle) -> Vec<usize> { vec![] }
}
```

- The default is empty, which is correct for the default raw `package` (it reads no names).
  Every content type that overrides `package` must override `bundle_dependencies` too.
- `Optimizer::bundle_dependencies` works the same way, also defaulting to empty.
- **Enforcement:**
  - Core sets `declared` on the bundle struct it is about to package (including relocated inline
    clones) and clears it afterwards.
  - `relative_url(from)` / `relative_specifier(from)` panic with a descriptive message unless
    `target == from` or `target.id ∈ from.declared`. This check is deterministic, so a bad
    declaration fails on the first test run.
  - `get_inline_bundle_content(i)` is checked against the embedder's declaration the same way,
    and returns a diagnostic instead of panicking.
  - `absolute_url()` and `name()` have no `from`. Their only packaging use is RSC (final reads of
    client CSS and bootstrap bundles). In Phase 2+ they check the _target_ side: they panic if the
    target isn't final and isn't in a cycle pass 1. So an undeclared read can never produce a
    template name silently; it's only caught when scheduling happens to expose it.
  - Outside packaging (`declared == None`: reporters, tests, HMR) nothing is checked.
- **Cost of over-declaring:**

  - It adds ordering constraints.
  - A declared cycle is always treated as real: two passes, with a composite hash shared by its
    members.
  - It over-invalidates incremental builds.

  So built-in declarations must be tight wherever cycles are plausible. The main risk would have
  been dynamic-import cycles, but those use stable keys, which aren't declared.

- **Shared decision logic.** The declaration and the packager need the same answers to "is this
  dependency inline?", "CommonJS or ESM?" and "library or app?". Factor that logic into helpers used
  by both, e.g. the JS dependency classification in `asset_dependencies`.
- A packager that needs its _own_ directory (`distDir` prefix, `__dirname` replacement) uses its
  template path's parent. A hash never changes a bundle's directory.

### D2. Hash references in names

- `Bundle::hash_reference() -> String` returns the structural id exactly as the name shows it
  today (`{:016x}`), so dev and no-hash output are byte-identical to the current output.
- A namer must include `hash_reference()` **exactly once in the file name** of every bundle that
  will be hashed. Core validates this after naming and emits a diagnostic naming the bundle and the
  namer. This mirrors v2's `hashReference` contract.
- The final path is `parent / file_name.replacen(hash_reference, hash)`. The hash is 8 characters
  of lowercase RFC 4648 base32 (`[a-z2-7]`, 40 bits) taken from xxh3-128 of the output. Lowercase
  avoids case-insensitive collisions. See Q1.
- There is a duplicate check on template names (as today) and on final names, compared
  case-insensitively. A collision on final names is an error; with 40 bits it is practically
  impossible, and it can be made deterministic later by rehashing with a salt, as Rollup does.
- A bundle is **hashed** iff all of these hold:
  - `options.content_hash` is on.
  - `!flags.contains(NEEDS_STABLE_NAME)`.
  - `bundle_behavior != Inline`.
  - The target is not `IS_LIBRARY`.
  - The environment is browser-side (`Browser`, `WebWorker`, `Worklet`, `ElectronRenderer`,
    `ReactClient`). `Node`, `ElectronMain` and `ReactServer` keep template names (Q2).
- Every other bundle's final path is its template path. It becomes final as soon as its own
  packaging finishes (it may still have to wait for the names it reads).

### D3. The scheduler: dependency-ordered packaging

This replaces the flat `par_iter` in `bundle_and_package`.

**Edges** come from `Content::bundle_dependencies` (D1). Core adds the declared dependencies of
every inline bundle a bundle embeds, transitively, because an inline child is packaged inside its
embedder.

Expected declarations for built-in packagers (after Phase 4):

- **JS hashed chunk:** sync JSON ESM imports, CommonJS `require` targets, and inline children.
- **JS context root:** its manifest closure.
- **CSS:** `url()` and `@import` targets, and inline children (data URLs). Also its referenced
  CSS bundles, but only when it `@import`s them (see Phase 5, CSS reference `@import`s).
- **HTML/SVG:** every bundle dependency, the script and style closure, and inline children.
- **RSC server bundles:** the client bundles whose URLs they embed.

**Algorithm.**

1. Build the declared graph over the bundles to package. Inline bundles are folded into their
   embedders. Run Tarjan to get the SCCs of the condensation.
2. Execute the condensation DAG with a dependency-counting work queue on rayon (`rayon::scope` with
   atomic in-degree counters). A component starts when every component it points at is final.
   Leaves (raw, image and font bundles) declare nothing, so they start immediately.
3. **Single-bundle component** (the common case): package it once. Every name it reads is final.
   Then `hash = xxh3_128(output bytes [+ map bytes])`; set the final path and hand the content to
   the writer.
4. **Multi-bundle component** (a declared cycle C):
   - **Pass 1:** package every member in parallel. Names of other members return their template;
     everything outside C is final.
   - `h_C = xxh3_128(sorted (id, pass-1 bytes) of C members, sorted final hashes of all declared non-C targets)`, and each member gets `hash = xxh3_128(h_C, member id)`.
   - Set the final paths of every member, then run **pass 2**: re-package every member with the
     final names, and write.
   - Soundness requires deterministic packaging. The pass-1 bytes, the identities of the
     template names they contain, and the targets' final hashes together determine the pass-2 bytes.
   - A later optimization could skip pass 2 for members that didn't actually read a member's name.
     That would need read tracking during pass 1 only; not planned.
5. **Self-reads** (a bundle reading its own name, e.g. a future `sourceMappingURL`, a map's
   `file` field, or a worker spawning itself) are always allowed and excluded from hashing. The
   name is written after the hash is computed, and the invariant holds because the name is a
   function of the hash.
6. **Inline bundles.** Base64, byte arrays, percent-encoding and anything else just work, because
   the child is packaged with final names before it is encoded. An inline bundle can't be in a cycle
   with its own embedder. That's a TODO/deadlock today (`lib.rs`); make it a diagnostic.
7. **Optimizers** run inside packaging (as today) on text that already contains final names. They
   need no placeholder contract; only name reads must be declared (D1). Globs match against the
   _template_ name, which has the same extension and directory.

**Writes** stay on the existing writer-thread channel. A bundle is sent to the writer once it is
final.

### D4. Leaf hashing

- Raw, image, font and other `FileContent` bundles have no reads, so their hash is simply the
  content hash.
- Add `Content::content_hash(&self) -> Result<u128>`:
  - Default: xxh3-128 over `read()`.
  - `FileContent`: streams the file through xxh3.
  - `ContentWithSourceMap`: code and map.
  - JS and CSS contents that hold a buffer: hash the buffer.
- Fix `FileContent::hash` to hash content, or delete it, since `Content::hash` has no callers.
- Optional (Phase 5): cache `FileContent` hashes keyed by `(path, size, mtime)` from `FileStat`,
  across incremental builds.

### D5. Cascade avoidance: the runtime manifest

**Stable keys everywhere in JS.**

- `loadJS(stable_key)`, `resolve(stable_key)` and `loadCSS(stable_key)`. `loadCSS` changes to
  resolve `publicUrl + (importMap[id] || id)` like `resolve`, which fixes Phase 0 bug #2.
- RSC keeps `name` lists as stable keys, and adds the 4th `importMap` argument to
  `createClientReference`. `react-server-dom-parcel` already applies it with
  `parcelRequire.extendImportMap(metadata[3])`.
- Server bundles are not hashed, so their reads of client final names only affect _ordering_.

**No static imports between hashed chunks.**

- Chunks are linked through the `parcelRequire` registry, not ESM bindings, so
  `write_bundle_references` exists only to make siblings load first. Emit it only for bundles that
  are **context roots with no external loader**: stable entries and worker entries.
- For every other bundle, the loader loads the **full transitive closure**
  (`graph.referenced_bundles(i)`; done in Phase 0):
  - lazy shims: `Promise.all([...closure].map(loadJS))`;
  - HTML: `<script>`/`<link>` for the full closure (the `// TODO: should be recursive` in
    `html/src/lib.rs`).
- This also removes request waterfalls.
- Hard references that remain (sync JSON ESM import, `CommonJS require`) are declared
  dependencies and work fine. They just cascade one level.

**Where the manifest lives.** It's one per execution context, in the smallest stable place
available:

| Context root              | Manifest placement                                                                                                                   | Hashed?                                            | Cascade stops at                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------- |
| HTML page                 | inline classic `<script>` injected before the first script, via `package.rs`'s existing prepend path (`html/src/package.rs:202-227`) | no (stable) or yes (iframe/object HTML, one level) | the page                                        |
| Stable JS entry (no HTML) | runtime prelude var `manifest`, merged into `importMap` before entries execute                                                       | no                                                 | the entry                                       |
| Worker / worklet entry    | embedded in the worker entry (option A)                                                                                              | yes                                                | the worker entry; its creator uses a stable key |
| Service worker            | embedded                                                                                                                             | no (stable, Phase 0 #3)                            | the SW                                          |
| RSC client reference      | `importMap` argument                                                                                                                 | server bundle not hashed                           | n/a                                             |

- The manifest contains `stable_key → final dist-relative name` for every hashed bundle reachable in
  that context. Reachability follows dependency resolutions (lazy, URL, isolated) and
  `referenced_bundles`, and stops at context boundaries, where the child context's entry key is
  included but not its internals.
- A page with several script roots gets one merged manifest.
- The first runtime on a page seeds `importMap` from the page's
  `<script type="application/json" data-parcel-manifest>` data blocks. Data blocks don't run, so
  CSPs allow them (Phase 5).
  - Superseded: an earlier version assigned a global from an inline script.
- Building the manifest reads the final names of its whole closure. So context roots are
  naturally scheduled last, and their hash (if they're hashed) depends on their context's
  bundles. That is the intended one level of cascade.
- Worker option B (the creator passes the manifest through the URL fragment, so the worker entry
  isn't cascaded) is a later optimization. Its caveats are in the session notes.
- Native `<script type="importmap">` is **not required**, because nothing in a hashed chunk uses a
  real ESM import of another chunk after this phase. Keep it as a possible future path for ESM
  output that wants real cross-chunk bindings.

**The resulting cascade.** Editing a module renames:

- the bundle it lives in;
- bundles that embed that bundle's final name: CSS `url()`/`@import` referrers, inline embedders,
  and a worker entry's manifest;
- context roots' manifests: HTML pages and entries, which are stable-named anyway.

### D6. Incremental rebuilds

- **Previous-build state** is keyed by the bundle's **template path** (stable across builds), and
  is updated only after packaging succeeds:

  ```rust
  struct PrevBundle { assets: Vec<AssetIndex>, final_path: PathId }
  ```

  Inline bundles keep their id-keyed composition map.

- **Statically dirty** (as before): the bundle is new, its composition changed, one of its assets
  changed, or it embeds a dirty inline bundle.
- **Dirty during scheduling:** a bundle whose declared dependency's final path differs from that
  dependency's previous final path is re-packaged.
  - This is discovered when the bundle's component runs, which is always after its dependencies
    are final, so it needs no fixpoint.
  - A clean pending bundle reuses its previous final path and is neither re-packaged nor
    re-written.
  - A cycle is packaged as a unit if any member needs packaging.
- **The "set of outputs changed → re-package everything" rule stays, but only for changes to
  the set of _template_ paths** (bundles added or removed).
  - Declarations cover _name_ dependencies only. A bundle's output can also depend on other
    bundles' structure without reading their names. For example, a lazy loader lists the
    `referenced_bundles` closure of its target by stable key.
  - Content hashes only change _final_ paths, and those are covered by declared dependencies, so
    hashing never triggers re-package-all.
- **Stale deletion** runs after packaging: every previous final path (and its `.map`) that no
  bundle writes to anymore is removed. That covers both removed and renamed outputs.
- `output_paths_changed` (used by HMR) is computed from template paths.

### D7. Options and CLI

- `BuildOptions.content_hash: Option<bool>`, and `ParcelOptions.content_hash: bool`, defaulting to
  `mode == Production`, like `optimize` (`core/src/entry.rs:44-54`).
- CLI: `--no-content-hash` in `crates/parcel/src/main.rs`. `serve` forces it off.
- Update every `BuildOptions { .. }` literal: the test harnesses, benches, `main.rs`,
  `parcel-plugin/tests/*`, and `core/tests/mock`.

### D8. Plugin ABI

- **Custom-content packagers** (`asset_set_custom_content`) get an optional
  `bundle_dependencies` callback. If it's absent, core uses a conservative declaration: every
  `Bundle { .. }` dependency target, the `referenced_bundles` closure, and inline children.
  Optimizer plugins get the same optional callback, defaulting to empty.
- `bundle_get_relative_url(bundle, from)` / `bundle_get_relative_specifier` are enforced like the
  Rust API. A violation returns an error code with a message instead of panicking across the FFI
  boundary.
- **New getters:** `bundle_get_stable_key` and `bundle_get_hash_reference`. `bundle_get_name` /
  `bundle_get_absolute_url` stay `from`-less, with the target-side check.
- **Namers** (native and JS) must include the hash reference. Expose `hashReference` on `JsBundle`
  (`plugin-js/src/plugin.rs:695-750`).
- v3's ABI is unreleased, so these are plain changes: bump the ABI version constant.

### D9. Source maps

- Maps are regenerated in each pass, so they're always correct. The map file is `<final name>.map`.
- Include map bytes in the hash (as esbuild does), so a map-only change such as `sourcesContent`
  can't be served stale under an unchanged name.
- The `sourceMappingURL` comment is appended when a bundle is written, after its name is known.
  It's a self-read (D3.5); see Phase 5.

---

## Phases

Each phase lands as its own commit series with tests passing. Phases 1–2 change no output.

### Phase 0: prerequisite fixes (independent) ✅ done, uncommitted

- [x] **HTML: inline targets.** Treat `referenced_bundle.bundle_behavior == Inline` like an inline
      dependency, which also covers the stylesheet `media` check. New case in
      `fixtures/inlining/data-url`.
- [x] **Service workers are stable-named.** `ServiceWorker` deps get
      `DependencyFlags::NEEDS_STABLE_NAME`.
  - The service worker fixtures previously inherited the repo root `package.json`
    (`engines.node`), so they built as _Node_ targets and never exercised service workers at all.
    `fixtures/workers/service-worker` now has its own `{}` package.json, and names and environments
    are asserted.
  - Two side effects:
    1. A classic service worker with `export` now errors, as it should. The fixture's test case was
       rewritten as a diagnostics test.
    2. The entry in `a/index.js` is now named `a/index.js`, because the stable-name common root
       includes the service workers in `b/`.
- [x] **Inline CSS `url()` base (bug #4 reproduced).** The inline bundle was packaged at its own
      namer path in the dist root.
  - `get_bundle_content` now packages an inline bundle relocated into its embedder's directory.
  - The cache is keyed by `(bundle index, directory)` (`InlineBundleCache`), and `Bundle` is now
    `Clone`.
  - New fixture `html/inline-subdir`.
- [x] **Async shim loads the transitive closure.** `BundleGraph::referenced_bundles` now yields
      pre-order with siblings in reference order (it used to reverse them), which also affects the
      order of RSC resources. Only JS and CSS bundles are included.
  - In practice, roots already reference every shared bundle placed for them. The closure only
    adds bundles reached through a shared bundle's own sync dependencies. It becomes load-bearing in
    Phase 4.
- [x] **`loadCSS`** takes a dist-root-relative name and resolves it through `publicUrl`, in both
      `runtime.js` and `dev-runtime.js`. New fixture `dynamic-import/lazy-closure`.

Found but not fixed: `crates/js/src/transformer.rs` drops the swc collector's `NEEDS_STABLE_NAME`
dependency flag (set for `__parcel_url_dep__(url, true)`). Fixture targets in general inherit
`engines.node` from the repo root `package.json`, so other browser-only behaviors may be untested
in the same way.

### Phase 1: name access and the dependency contract ✅ done, uncommitted (no output change)

- [x] `Bundle` gains `pub name_state: NameState` (`final_path: OnceLock<PathId>` + declared ids;
      construct with `Default::default()`; manual `Clone` resets declarations).
  - New methods: `stable_key()`, `hash_reference()`, `may_be_content_hashed()`,
    `set_final_path()`, `has_final_path()`, `begin_packaging()` / `end_packaging()`,
    `may_access()`.
  - `dist_path()`, `name()`, `absolute_url()` and `relative_url()` return the final path when
    set. `stable_key()` always uses the template.
- [x] `relative_url(from)` / `relative_specifier(from)` panic with a descriptive message on
      undeclared access while `from` is packaging.
- [x] `Content::bundle_dependencies` and `Optimizer::bundle_dependencies`, both defaulting to
      empty.
- [x] `package_bundle` declares content and optimizer dependencies through a drop guard, including
      for relocated inline clones. `get_inline_bundle_content` returns a diagnostic on undeclared
      access.
- [x] Runtime keys use `stable_key()`: `loadJS`, `loadCSS`, the Url shim, RSC
      `client_bundle_names` and `server_actions`.
- [x] Declarations:
  - **JS** (`packager::bundle_dependencies`, sharing `is_inline_bundle_dependency`,
    `is_async_bundle_dependency` and the new `is_sync_bundle_dependency`):
    - library: every bundle dependency target;
    - classic scripts: none;
    - app: referenced JS bundles, inline targets, CommonJS closures of async targets, and sync JSON
      bundles;
    - RSC environments: the closure of every target plus the closure of the bundle's references.
  - **CSS:** referenced CSS plus all bundle dependency targets. **Style attributes:** all targets.
  - **HTML/SVG:** targets plus each target's direct `referenced_bundles`.
  - **Mock:** `referenced_bundles`.
  - **ABI custom content:** a conservative default (targets plus the referenced closure).
  - New helper: `BundleGraph::bundle_dependency_targets`.
- [x] The whole suite passes with enforcement on. A mutation check (an empty CSS declaration)
      fails 19 fixtures with the contract error.
- [x] ABI: appended `bundle_get_stable_key` and `bundle_get_hash_reference`. Appending doesn't
      bump `PARCEL_ABI_VERSION`, per `api.rs`.
  - Wrappers added to the Rust SDK (`Bundle::stable_key`, `hash_reference`), the Go SDK
    (`StableKey`, `HashReference`) and JS plugins (`bundle.hashReference`).
  - The relative name getters treat undeclared access as unavailable (an empty buffer), since a
    panic can't unwind across the FFI. Documented in `plugin-go/CUSTOM_CONTENT.md`.
- [x] Namers: the default namer and `MockNamer` use `hash_reference()`. Core warns when a bundle
      that may be content hashed lacks exactly one hash reference in its file name, and
      debug-asserts that bundle ids are unique.
- [x] Tests: `Bundle` unit tests (enforcement, final paths, clones), the core integration test
      `packaging_rejects_undeclared_name_access` (mock `@undeclared` directive), ABI getter and
      enforcement tests, and a JS namer `hashReference` test.
- **Deferred:** an ABI callback that lets custom-content plugins declare precise dependencies
  (the conservative default applies meanwhile). It needs a new appended
  `asset_set_custom_content` variant plus SDK plumbing.

**Note for Phase 2:** a bundle whose name isn't hashed (stable-named, server-side, library) is
final from the start. So an edge _to_ it never constrains scheduling and can't form a cycle.
Only edges to hashed bundles matter for ordering, which keeps over-declaration (e.g. RSC closures,
which point from server bundles to client bundles) harmless.

### Phase 2: scheduler and incremental state ✅ done, uncommitted (no output change)

- [x] New module `crates/core/src/packaging.rs`: the moved `package_bundle`/`get_bundle_content`/
      inline cache, plus `package_bundles`, the scheduler:
  - Declarations are computed for every bundle; inline bundles are folded into their embedders.
  - Edges go only to _pending_ bundles (`is_pending` = `may_be_content_hashed()` in Phase 2, so the
    ordering is exercised even though names don't change yet).
  - An iterative Tarjan builds the components; `rayon::scope` runs them with atomic in-degree
    counters. The first error aborts scheduling.
  - A cycle runs pass 1 with members marked provisional, names them together, and runs pass 2 only
    if a member's final path differs from its template. Each pass gets its own inline cache, so
    provisional inline content isn't reused.
- [x] Target-side check: `NameStatus` (Template / Pending / Provisional) on `NameState`. `name()`,
      `absolute_url()` and `relative_url()` (except self-reads) panic when reading a pending
      name that has no final path.
  - `Bundle::is_name_available()` lets the ABI getters return "unavailable" instead of panicking.
  - The ABI `dist_path` getter now returns the final path.
- [x] D6 incremental state: `PrevBundle` keyed by template path; scheduling-time dirtiness through
      declared dependencies; stale deletion after packaging.
- [x] Verbose log: bundles packaged, second passes, naming cycles and the largest one.
- [x] Tests:
  - Tarjan unit tests;
  - `bundles_that_reference_each_other_are_packaged_together` (mock async cycle, initial build and
    rebuild);
  - ABI tests for pending names;
  - a mutation check: ignoring ordering trips "name … read before it was known" across fixtures.
- [x] **Benchmark** on the react-spectrum S2 storybook (release, LTO off for both builds, 12
      interleaved runs each):
  - Phase 1: median 666.7 ms (min 608.9). Phase 2: median 656.8 ms (min 612.9). No measurable
    overhead.
  - Output matches Phase 1, except for the pre-existing nondeterminism below.
- **Fixed (uncommitted): bundle ids were not deterministic across identical builds.**
  - Cause: the id of a root made of merged concurrent imports (`Promise.all([import(a), import(b)])`) hashed its members' asset ids in `BundleRoots::members` order. That order is
    by asset index, which depends on the order assets finish transforming.
  - Every shared bundle reachable from such a root inherited the random id through
    `BundleKey::stable_hash`. On the storybook that was one JS and one CSS shared bundle, plus
    `preview-main`, which embeds their names.
  - Fix: sort the member ids before hashing (`crates/parcel/src/bundler.rs`).
  - Verification: 6 consecutive storybook builds produce identical bundle graphs (before and after
    the optimizer) and byte-identical outputs (428 files).
  - Regression tests in `bundler/tests.rs` (via a `reindexed` helper that stores the same graph
    under different asset indices):
    - `bundle_ids_do_not_depend_on_asset_indices` fails without the fix;
    - `bundle_graphs_do_not_depend_on_asset_indices` compares the whole normalized bundle graph
      over 3 permutations, in development and production mode.
- **Open:** `less/less-url-rewrite` failed once in a full `cargo test --workspace` run (message not
  captured). It didn't reproduce in 6 full-suite runs or 40 targeted runs under load.

### Phase 3: content hashing ✅ done, uncommitted

- [x] **Option and CLI.** `BuildOptions.content_hash: Option<bool>` and `ParcelOptions.content_hash`
      (default: production mode); CLI flag `--no-content-hash`; the fixture harness gets
      `"contentHash"` and a `PARCEL_TEST_CONTENT_HASH=1` override.
- [x] **Which bundles are hashed:** `content_hash && may_be_content_hashed()` and the namer
      included the hash reference exactly once. The namer decides (it resolves the TODO in
      `bundler.rs`); there's no warning for names without a reference.
- [x] **The hash:** `Content::content_hash() -> u128` (xxh3-128 over the written bytes, source
      map included) replaces the unused `Content::hash`, which hashed `FileContent`'s path.
  - The name is 8 lowercase base32 characters (`[a-z2-7]`) substituted for the hash reference.
  - A cycle hashes the sorted (id, pass-1 hash) pairs of its members, then each member's id. Pass-1
    bytes already contain every name outside the cycle.
- [x] **Written paths are claimed case-insensitively.** Bundles with the same content hash and
      name share a file, written once. That collapsed 20 duplicate CSS files on the storybook.
  - Any other collision is an error.
  - The content hash is kept in `PrevBundle`, so a reused bundle can share a file with others
    again.
- [x] **The runtime manifest, pulled forward from Phase 4.** Phase 1 already switched loaders to
      stable keys, so hashing needs the manifest to work at all. It's emitted by JS context roots:
  - A context root is a JS bundle with non-empty `entry_assets` (entries, page scripts, workers,
    URL imports).
  - A root's manifest covers every hashed bundle reachable in its context, and the root declares
    that closure.
  - The runtime gets a `manifest` global (`k` when minified), merged into the shared `importMap`.
- [x] **RSC:** `createClientReference` gets its 4th `importMap` argument (stable key → final name).
- [x] **Tests:**
  - `content-hash/lazy`: runnable, with lazy imports through the manifest. It fails with an empty
    manifest.
  - `incremental.rs`:
    - `content_hashed_names_follow_their_content`: every change is also compared to a fresh
      build. Covers renames, cascade limits, stale deletion and name restoration.
    - `bundles_with_identical_content_share_a_content_hashed_file`.
  - `incremental_build.rs`: `bundles_that_reference_each_other_are_hashed_together` (two passes,
    determinism, renames and removals).
  - The RSC `client-references` import map case.
  - 12 snapshot fixtures in production mode opt out with `"contentHash": false`, since their
    snapshots test ordering, not names.
  - Fixed `import-attributes/url`'s hex-only regex.
- [x] **Storybook** (react-spectrum S2, production, `--no-optimize`):
  - Deterministic across 3 builds; 0 naming cycles; every non-HTML JS/CSS output is hashed.
  - Timing (10 interleaved runs): hashing on, median 747 ms (a second session: 694 ms);
    `--no-content-hash`, 652 ms; hashing without the manifest ordering (timing experiment only),
    638 ms.
  - So hashing itself is nearly free. The cost (~55–95 ms) is roots waiting for their whole lazy
    closure before packaging, which is Phase 4's HTML-inline manifest's job for HTML-hosted
    roots.

### Phase 4: cascade and critical-path reduction

Decision (2026-09-26): keep the Parcel runtime manifest as the only resolution mechanism, rather
than a native import map.

- Bundles link through the `parcelRequire` registry, not ESM bindings. So static imports between
  chunks only make siblings load first, and can be hoisted into whoever loads the chunk.
- Native import maps don't cover `loadCSS`, URL/worker resolution, workers, or classic scripts.
  They need a browserslist fallback and merging with page import maps, and their keys depend on
  the base URL.
- They stay a future option for SRI (integrity-only maps) and for real cross-chunk ESM linking.

**Status: ✅ done, uncommitted.**

- [x] **HTML pages hold the manifest for the JS roots they load.**
  - A root is page-hosted if it isn't an entry and every bundle referencing it is a page
    (`BundleGraph::is_page_hosted`, computed once per graph and cached).
  - The HTML packager prepends a classic script (`PackageOptions::head_script`) that assigns
    `globalThis.parcelRequireImportMap`. `</` is escaped as `<\/`.
  - The runtime merges that global, then its own `manifest`, into the shared `importMap`.
  - Entries, workers and URL imports still embed their own manifest.
- [x] Moved to core: `Bundle::is_context_root` and `BundleGraph::context_closure`.
- [x] **Static imports only in roots that aren't page-hosted,** covering the full static
      closure (`static_imports`). Non-root and page-hosted bundles import nothing. HTML loads the
      full `referenced_bundles` closure of each script (the old `TODO: should be recursive`).
  - **Review fix (2026-09-27): async roots wait for their closure.**
    - Deferred module scripts run in document order, after the shared tags prepended to `<head>`.
    - `async` scripts are `Isolated`, but the bundler still splits code shared between isolated
      roots. So an async root could run before the page's tag for its shared bundle, and throw
      `Cannot find module`.
    - Page-hosted `Isolated` roots now list their same-environment JS closure by stable key in the
      `awaitedBundles` runtime global (`b` minified; `dependencies::awaited_bundles`). The runtime
      `loadJS`es those, then runs its entries. The browser's module map shares instances with the
      page's tags, so nothing loads twice, and the root still doesn't depend on their names.
    - Deferred roots run their entries synchronously as before, so they still run before
      `DOMContentLoaded`.
    - Fixture `html/async-shared` (production and development runtimes). The harness now runs
      `async` module scripts before a page's other scripts, and drains the job queue after
      loading them.
    - Follow-up (2026-09-27): `Target::loc` was removed. It was part of target identity, so every
      `<script>` tag and worker site got its own copy of each module, and scripts never shared
      bundles. Classic (`Global`) bundles are now wrapped in an IIFE, and classic workers
      `importScripts` their static imports, since sharing now reaches them.
    - Browser check: with the shared bundle's response delayed 1 s, all three async scripts ran;
      without the barrier each threw `Cannot find module`.
- [x] **Declarations:**
  - JS: roots that hold a manifest declare their context closure and static imports; other JS
    bundles only declare inline, sync JSON, CommonJS-loaded and RSC targets.
  - HTML: the transitive closure of each target, plus the context closure of its page-hosted
    roots.
- [x] **Tests:**
  - `content_hashed_names_follow_their_content` now asserts that editing a lazy module renames
    only it and the page, not the page's script, and that the script doesn't embed lazy names.
  - The fixture harness runs a page's inline classic scripts before its external scripts, so
    `content-hash/lazy` exercises the page manifest.
  - `client-references` pins its first case to `contentHash: false`.
  - All suites pass. With `PARCEL_TEST_CONTENT_HASH=1` only 2 SVG snapshot fixtures differ
    (expected, since they embed names).
- [x] **Storybook:**
  - Deterministic; no chunk contains a static import; the page carries the manifest.
  - Timing (10 interleaved runs): hashing on, median 661.4 ms; off, 665.0 ms. The Phase 3 cost is
    gone.

### Browser verification (2026-09-26)

Tested with the real `yarn build:storybook-s2-parcel3` flow: a `parcel3` wrapper pointed at the
local release binary, the output served statically, and every entry opened in headless Chromium
via Playwright. Per page we recorded whether it rendered (`#storybook-root` or `#storybook-docs`
non-empty), console errors, page errors and failed requests.

- **Found a Phase 4 regression, now fixed (uncommitted).**
  - Symptom: stories intermittently failed with `Cannot find module …` (`actionbar--*`), with or
    without hashing. The Phase 3 build was clean over 40 loads.
  - Cause: the runtime runs `mainEntry` on load, and the packager wrote it for every bundle with a
    single root, including lazily loaded ones. Their static imports used to guarantee siblings ran
    first. Once those were removed, a lazy bundle could run before a sibling it depends on
    (`CardView`) had loaded.
  - Fix: `mainEntry` is only written for bundles that execute on load (non-empty `entry_assets`).
    Lazy bundles are run by their loader after `Promise.all`.
  - Regression test: a `dynamic-import/lazy-closure` case asserts lazy bundles emit
    `mainEntry = null`. It fails without the fix.
- **Results after the fix:**
  - 365 stories × 3 runs with hashing on; plus without hashing, and on the Phase 3 build: 365/365
    rendered every time, with no console errors, page errors or failed requests.
  - 85 docs pages, with and without hashing: 85/85 rendered, no errors.

### Docs site verification (RSC, 2026-09-26)

Built the react-spectrum S2 and React Aria docs sites with the steps of `yarn build:s2-docs-parcel3`
(`parcel3 build ssg-*.tsx`, then Node prerenders every page), with and without hashing. Then every
page was opened in headless Chromium.

- **A pre-existing bug made the base commit (`8bb32a53a`) render 0 pages.**
  - CommonJS async loads and RSC's synchronous proxies required bundles by relative path through
    the runtime's `r`. That falls back to the Node `require` of whichever bundle ends the global
    chain, so paths resolved against the wrong directory.
  - Fix: use the owning bundle's `module.bundle.nodeRequire`.
  - With just this fix, base renders all 117 + 213 pages with no errors, which is the reference.
- **Phase 4 regression, found by bisecting (Phases 0–3 were clean).**
  - Server code imports modules `with {env: 'react-client'}` synchronously; these live in client
    bundles. RSC's loaders only load same-environment closures, so once non-root bundles stopped
    importing siblings, nothing loaded those client bundles.
  - Fix: every bundle still statically imports referenced bundles in _other_ environments. They're
    imported by unhashed server bundles, so this doesn't cascade.
  - Fixture: `react-server/lazy-client-env-import`, which fails without the fix.
- **Hashing gaps, now fixed:**
  - Client code running during SSR lazily loads client bundles by stable key.
    `BundleGraph::context_closure` of a ReactServer root now also enters ReactClient bundles,
    because they share one runtime in the server process.
  - In the browser, client references' import maps now cover the context closure of their bundles
    (`rsc::client_bundle_import_map_dependencies`), so their lazy imports resolve.
  - Client reference `bundles` lists are **final names**, not stable keys. React also emits them as
    `<script>`/preload URLs during SSR without applying the import map. Server bundles aren't
    hashed, so this costs nothing.
  - The bundle a client reference's lists come from is the first bundle containing the importer
    (now cached: `BundleGraph::first_bundle_containing`), which may differ from the bundle being
    packaged. RSC declarations cover those bundles too. The target-side check caught this as a
    panic.
- **Results:**
  - Prerendering: 117/117 S2 and 213/213 React Aria pages, 0 errors, hashed and unhashed.
  - Browser: the pages with errors are identical in the hashed, unhashed and base+fix builds. S2:
    `LabeledValue`, `ai`, `mcp`. React Aria: `ai`, `index`, `mcp` and 3 blog posts. These are
    React hydration error #418 and a `/ai` fetch 404, so they're pre-existing and not bundling
    issues.
  - Every requested client file uses its hashed name; no 404s from bundling.

### Phase 5: follow-ups, in priority order (2026-09-26)

1. [x] **Content Security Policy** ✅ done, uncommitted.
   - The page manifest is now a non-executable data block,
     `<script type="application/json" data-parcel-manifest>{…}</script>` (`PackageOptions::manifest`),
     prepended to `<head>`. `</` is escaped as `<\/`.
   - The first runtime on a page (`!previousRequire`) reads every such block with
     `document.querySelectorAll` + `JSON.parse` into the shared `importMap`. That replaces the
     `globalThis.parcelRequireImportMap` assignment, which also settles Q4.
   - Tests:
     - HTML unit test `manifest_is_a_data_block_before_every_script`;
     - the fixture harness stubs `document.querySelectorAll` from the page's data blocks, so
       `content-hash/lazy` exercises the runtime path; a production (minified) case was added.
   - **Browser check:** a throwaway app served with `Content-Security-Policy: default-src 'self'`.
     - The module-script page lazy-loaded a module and its CSS under hashed names.
     - The only violation was a deliberate canary inline script, which proves the policy was
       enforced; the manifest block itself raised none.
     - Storybook re-run: 365/365 stories and 85/85 docs pages still clean.
   - **Found, pre-existing and unrelated:** a classic (non-module) `<script src>` is emitted as
     is (`SourceType::Script`), so its `import()` is never bundled or resolved.
2. [x] **`sourceMappingURL` comment** ✅ done, uncommitted.
   - `ContentWithSourceMap::write` appends `//# sourceMappingURL=<name>.map` (JS: `js`/`mjs`/`cjs`)
     or `/*# sourceMappingURL=<name>.map */` (CSS). The URL is relative and percent-encoded, taken
     from the final written path.
   - It's skipped when the last 4 KB of the code already contain one, e.g. from a plugin optimizer.
   - It's appended at write time, after hashing. It's the self-read case: the comment is a function
     of the name, which is a function of the hash, so the invariant holds.
   - Inline bundles are embedded via `read()`, which never adds it.
   - Tests:
     - `content::tests::source_maps_are_linked_from_the_code_that_uses_them` (JS, CSS with
       percent-encoding, an existing comment kept, HTML untouched);
     - 80 fixture snapshots re-recorded; the diff only adds the comment, and a final newline where
       the file had none.
   - **Browser check** (DevTools protocol, a throwaway hashed app): Chrome reported a
     `sourceMapURL` for the entry script, the lazy chunk and both stylesheets (one loaded lazily),
     and each resolved (HTTP 200) to a valid v3 map.
   - Not done (pre-existing): `TargetSourceMapOptions { inline, inline_sources, source_root }` are
     parsed but unused. Inline (data-URL) maps would build on this same comment.
3. [x] **CSS reference `@import`s only where needed** ✅ done, uncommitted.
   - The CSS packager used to `@import` every referenced CSS bundle. Pages and Parcel's loaders
     already load a bundle's reference closure in cascade order, so the `@import`s only loaded
     those sheets twice and made each sheet's hash depend on theirs.
   - `BundleGraph::is_loaded_with_references(bundle)`: not an ENTRY, and every dependency-target
     referrer is HTML/XHTML/SVG. Bundles reached only through `referenced_bundles` (loaders) also
     qualify.
     - Such a sheet emits no reference `@import`s and doesn't declare its referenced CSS.
     - Entries, and sheets reached by a CSS `@import`, a URL or inline embedding, keep them, since
       nothing else loads their references.
   - `is_page_hosted` shares the same cached referrer kinds (`Referrers { html, svg, other }`).
   - Tests:
     - 9 snapshots in 6 page fixtures drop the `@import`; the HTML is unchanged, and
       `entry-referenced-bundles` still `@import`s;
     - fixtures for the other kept cases, each failing if non-entries drop their `@import`s:
       `css/referenced-bundles-css-import` (a sheet linked by a page and `@import`ed by an entry),
       `css/referenced-bundles-url` (`new URL()`) and `css/referenced-bundles-inline`
       (`bundle-text:`);
     - incremental `stylesheets_loaded_with_their_references_do_not_depend_on_them` (pages and
       lazy loaders): changing the shared sheet renames only it and updates the pages.
4. [ ] **`manifest.json` output for server-rendered apps**, which lets a non-Parcel server find
       hashed names. It would also allow content hashing JS entries. Do it when a consumer needs it.
5. [ ] **Subresource Integrity** (opt-in):
   - `integrity` on HTML tags;
   - for dynamically imported chunks, a native import map containing only the `"integrity"` field,
     which works independently of `"imports"`. `import()` has no other way to carry integrity.
6. **Only if profiling or feedback calls for them:**
   - [ ] Cache `FileContent` hashes by `(path, size, mtime)`. Incremental builds already skip
         unchanged bundles, and the storybook showed no measurable hashing cost.
   - [ ] Worker option B: the creator passes the worker's manifest through the URL fragment, so the
         worker entry doesn't depend on its closure.
   - [ ] ABI callback so custom-content plugins can declare precise dependencies (the conservative
         default applies today).
   - [ ] **Id-based manifest keys, hybrid.** A bundle whose name is content hashed uses (a
         shortened) id as its stable key; everything else keeps its dist-relative name, so the
         `importMap[key] || key` fallback still needs no manifest for unhashed bundles.
     - Storybook measurement with 16-hex ids: page manifest 13.6 → 10.6 KB raw, 6.1 → 5.5 KB gzip
       (the manifest is about 60% of `iframe.html` gzipped); loader call-site keys 12.5 → 9.3 KB
       across chunks.
     - 8–10 base36 characters with a build-time duplicate check would roughly double that.

## Testing

**Unit tests (core, mock packager).** Mock content that reads names through the new API lets us
build arbitrary graphs.

- Topological order: every packager observes only final names. Assert on the bytes.
- Contract violation: a mock that reads an undeclared bundle gets a descriptive panic, or a
  diagnostic for inline content.
- A 2-cycle and a 3-cycle with a tail: pass-1/pass-2 counts, identical hashes across runs, and a
  change to any member renames every member.
- Self-read is excluded from the hash.
- Inline children's declarations propagate to every embedder, including through a cached inline
  bundle.
- Incremental:
  - editing a leaf re-packages only the leaf and its readers;
  - an unchanged bundle is not re-written;
  - renamed outputs are deleted;
  - a config change still deletes stale outputs.

**Integration tests (`crates/parcel/tests`), with hashing on.**

- Basic app: HTML + JS with a lazy import + CSS with an image. Names match `-[a-z2-7]{8}\.`, the page
  runs (existing HTML run harness), and the source maps resolve.
- **Cascade test:**
  - edit a lazily loaded module: only that chunk is renamed, plus the HTML manifest;
  - edit an image: the image, the CSS that references it, and the HTML are renamed, and the JS
    chunks are not;
  - edit a worker chunk: the worker chunk and worker entry are renamed, and the parent chunk is not.
- **Determinism:** build twice from a clean state, and the outputs are byte-identical, names
  included. Also build with 1 thread vs N threads.
- Inline: a data-url SVG that references an image (base64), and an inline `<style>` with `url()`.
- RSC fixture: the client reference carries `importMap`, and the server output references final
  client names.
- Service worker keeps `sw.js`. Library targets and node targets are unhashed.
- `--no-content-hash` and dev builds match the current output byte for byte, so existing snapshots
  still pass.

**Invariant checks (`debug_assertions`).**

- Re-hash every written file and compare it with the name.
- Assert no provisional name (template path) appears in any hashed output.
- Assert no bundle is modified after finalization.

**Existing tests to revisit.**

- These assume name stability, which still holds with hashing off (dev default), so they stay valid
  but must run with hashing explicitly off:
  - `core/tests/incremental_build.rs::incremental_rebuild_keeps_referenced_bundle_name_when_composition_changes`
  - `parcel/tests/hmr.rs::css_bundle_name_is_stable_when_its_assets_change`
- `test.rs` harness builds default to Development, so snapshot names are unaffected. Add a
  `"contentHash": true` knob to `test.json`.

**Benchmark.** Run react-spectrum storybook, production, compared with base `core-rs3`: total time,
the packaging phase, and pass-2 count (expected ≈0).

---

## Risks and mitigations

| Risk                                                                                            | Mitigation                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Non-deterministic packaging (e.g. HashMap iteration order) breaks cycle hashing and determinism | Determinism test with 1 vs N threads, plus the debug re-hash check. Fix the offenders found.                                                                 |
| Ordering reduces packaging parallelism                                                          | The condensation DAG is shallow and wide (leaves → chunks → roots). Measure in Phase 2 before hashing is on.                                                 |
| A built-in declaration drifts from what its packager reads                                      | Enforcement panics deterministically on `relative_url(from)`, so the whole fixture suite validates declarations. Shared classification helpers reduce drift. |
| Over-declaration creates false cycles (two passes, shared hash)                                 | Built-in declarations are tight. Stable keys keep dynamic-import cycles out of the graph. Verbose logging reports declared cycles.                           |
| Large manifests in big apps                                                                     | Keys are stable names (compressible). Consider short ids or splitting per dynamic boundary (Q3).                                                             |
| Removing static sibling imports breaks a loader path we missed                                  | Phase 0 fixes the async closure first. The HTML closure and RSC `client_bundle_names` are already recursive. The integration run harness covers it.          |
| Inline bundle embedded in a cycle with its embedder                                             | Currently a deadlock TODO. Make it a diagnostic in Phase 2.                                                                                                  |

## Open questions

- **Q1. Hash length and alphabet.** Decided: 8 lowercase base32 characters, `name-hash.ext`.
- **Q2. Hash server-side targets?** Decided: no (Node, ElectronMain, ReactServer).
- **Q3. Manifest shape.** Decided: each context root's manifest includes only bundles reachable
  from that root, never the whole app. Still open: full dist-relative names as values, or
  `key → hash` plus a runtime template.
- **Q4. Global name for the HTML-injected manifest.** Resolved: no global. It's a
  `data-parcel-manifest` JSON data block the runtime reads (Phase 5 CSP).
- **Q5. `write_bundle_references` for `global` output format workers.** They currently emit
  `import` even in Global format. Confirm this is intended before relying on it for worker entries.
