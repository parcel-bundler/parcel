//! Parcel's own runtime modules, which the JS transformer inserts imports of, e.g. React Refresh. They are embedded in Parcel rather than installed with it, so a project builds the
//! same however Parcel was installed (locally, globally, or through npx), and they always match
//! the transformer that imports them. The default resolver returns them for their exact
//! specifiers (see [`runtime_module`]).

pub(crate) const MDX_COMPONENTS: &str = "@parcel/parcel3/src/mdx-components";
pub(crate) const REACT_REFRESH: &str = "@parcel/parcel3/src/react-refresh.js";
/// Required by `react-refresh.js`. Not `react-refresh/runtime`, so a project's own import of that
/// still resolves to the project's copy.
const REACT_REFRESH_RUNTIME: &str = "@parcel/parcel3/src/react-refresh-runtime.js";

bitflags::bitflags! {
  /// The functions modules converted from ESM to CommonJS call (see `esm-helpers.js`), which the
  /// packager defines: once per app bundle, and in each library module that calls them. The
  /// development runtime also passes them to hot updates as arguments, in the order of
  /// `ESM_HELPER_FUNCTIONS` (see `hot_update_code`).
  #[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
  pub struct EsmHelpers: u8 {
    const EXPORT = 1 << 0;
    const EXPORT_ALL = 1 << 1;
    const INTEROP_DEFAULT = 1 << 2;
    const DEFINE_INTEROP_FLAG = 1 << 3;
  }
}

include!(concat!(env!("OUT_DIR"), "/esm-helpers.rs"));

/// Each ESM helper (see `EsmHelpers`), the function the transformer calls for it, and its name in
/// optimized app bundles, which must not collide with the runtime's globals (`RUNTIME_GLOBALS` in
/// build.rs, which lists these too so the runtime's minifier doesn't use them).
pub(crate) const ESM_HELPER_FUNCTIONS: &[(EsmHelpers, &str, &str)] = &[
  (EsmHelpers::EXPORT, "$parcel$export", "t"),
  (EsmHelpers::EXPORT_ALL, "$parcel$exportAll", "a"),
  (EsmHelpers::INTEROP_DEFAULT, "$parcel$interopDefault", "i"),
  (
    EsmHelpers::DEFINE_INTEROP_FLAG,
    "$parcel$defineInteropFlag",
    "f",
  ),
];

impl EsmHelpers {
  /// The function the transformer calls for a single helper.
  pub(crate) fn function(self) -> &'static str {
    ESM_HELPER_FUNCTIONS
      .iter()
      .find(|(helper, _, _)| *helper == self)
      .map(|(_, function, _)| *function)
      .unwrap_or_else(|| panic!("not a single ESM helper: {self:?}"))
  }

  /// The helper a function the transformer calls is for, if it is one, and its name in optimized
  /// app bundles.
  pub(crate) fn from_function(function: &str) -> Option<(EsmHelpers, &'static str)> {
    ESM_HELPER_FUNCTIONS
      .iter()
      .find(|(_, name, _)| *name == function)
      .map(|(helper, _, minified)| (*helper, *minified))
  }
}

/// An embedded runtime module.
pub struct RuntimeModule {
  /// Where the module would be in `node_modules` if it were installed, e.g.
  /// `@parcel/parcel3/src/react-refresh.js`. Its extension is the module's type.
  pub path: &'static str,
  pub source: &'static str,
}

/// The embedded runtime module a specifier names, if any.
pub fn runtime_module(specifier: &str) -> Option<RuntimeModule> {
  let (path, source) = match specifier {
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
