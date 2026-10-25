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
