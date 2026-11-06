//! Parcel's own runtime modules, which the JS transformer inserts imports of, e.g. the ESM
//! helpers. They are embedded in Parcel rather than installed with it, so a project builds the
//! same however Parcel was installed (locally, globally, or through npx), and they always match
//! the transformer that imports them. The default resolver returns them for their exact
//! specifiers (see [`runtime_module`]).

pub(crate) const ESM_HELPERS: &str = "@parcel/parcel3/src/esmodule-helpers.js";
pub(crate) const MDX_COMPONENTS: &str = "@parcel/parcel3/src/mdx-components";
pub(crate) const REACT_REFRESH: &str = "@parcel/parcel3/src/react-refresh.js";
/// Required by `react-refresh.js`. Not `react-refresh/runtime`, so a project's own import of that
/// still resolves to the project's copy.
const REACT_REFRESH_RUNTIME: &str = "@parcel/parcel3/src/react-refresh-runtime.js";

/// The ESM helpers as functions that optimized app bundles define (see `esm-helpers.js`), so
/// modules can call them directly rather than through a require of `ESM_HELPERS` in every module.
/// Each is the helper's name in `ESM_HELPERS`, the function the transformer calls, and its name in
/// the bundle, which must not collide with the runtime's globals (`RUNTIME_GLOBALS` in build.rs,
/// which lists these too so the runtime's minifier doesn't use them).
pub(crate) const ESM_HELPER_FUNCTIONS: &[(&str, &str, &str)] = &[
  ("export", "$parcel$export", "t"),
  ("exportAll", "$parcel$exportAll", "a"),
  ("interopDefault", "$parcel$interopDefault", "i"),
  ("defineInteropFlag", "$parcel$defineInteropFlag", "f"),
];

/// The function the transformer calls for an ESM helper (see `ESM_HELPER_FUNCTIONS`).
pub(crate) fn esm_helper_function(helper: &str) -> &'static str {
  ESM_HELPER_FUNCTIONS
    .iter()
    .find(|(name, _, _)| *name == helper)
    .map(|(_, function, _)| *function)
    .unwrap_or_else(|| panic!("unknown ESM helper {helper}"))
}

/// The name in the bundle of a function the transformer calls for an ESM helper, if `function` is
/// one (see `ESM_HELPER_FUNCTIONS`).
pub(crate) fn esm_helper_bundle_name(function: &str) -> Option<&'static str> {
  ESM_HELPER_FUNCTIONS
    .iter()
    .find(|(_, name, _)| *name == function)
    .map(|(_, _, minified)| *minified)
}

/// An embedded runtime module.
pub struct RuntimeModule {
  /// Where the module would be in `node_modules` if it were installed, e.g.
  /// `@parcel/parcel3/src/esmodule-helpers.js`. Its extension is the module's type.
  pub path: &'static str,
  pub source: &'static str,
}

/// The embedded runtime module a specifier names, if any.
pub fn runtime_module(specifier: &str) -> Option<RuntimeModule> {
  let (path, source) = match specifier {
    ESM_HELPERS => (
      ESM_HELPERS,
      include_str!("runtime_modules/esmodule-helpers.js"),
    ),
    MDX_COMPONENTS => (
      "@parcel/parcel3/src/mdx-components.jsx",
      include_str!("runtime_modules/mdx-components.jsx"),
    ),
    REACT_REFRESH => (
      REACT_REFRESH,
      include_str!("runtime_modules/react-refresh.js"),
    ),
    // react-refresh 0.19.0, vendored unmodified from its cjs/react-refresh-runtime.development.js.
    // To update, copy that file from a newer release (`npm pack react-refresh@<version>`), and
    // check that the exports `react-refresh.js` uses still exist.
    REACT_REFRESH_RUNTIME => (
      REACT_REFRESH_RUNTIME,
      include_str!("runtime_modules/react-refresh-runtime.development.js"),
    ),
    _ => return None,
  };
  Some(RuntimeModule { path, source })
}
