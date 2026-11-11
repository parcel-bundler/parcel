//! The React Refresh wrapper, which the packager adds to the generated code of modules the
//! transformer flagged (see `TransformAstResult::react_refresh`), which are only in unoptimized
//! output. Its first part goes before the module's code and any async module wrapper around it,
//! and the rest inside the async module wrapper, around the module's code, including its prologue:
//!
//! ```js
//! var $parcel$ReactRefreshHelpers = require('@parcel/parcel3/src/react-refresh.js');
//! $parcel$ReactRefreshHelpers.init();
//! var $parcel$module = module;
//! // <the async module wrapper's opening, if any>
//! var prevRefreshReg = globalThis.$RefreshReg$;
//! var prevRefreshSig = globalThis.$RefreshSig$;
//! $parcel$ReactRefreshHelpers.prelude($parcel$module);
//! try {
//!   <the module's code>
//!   $parcel$ReactRefreshHelpers.postlude($parcel$module);
//! } finally {
//!   globalThis.$RefreshReg$ = prevRefreshReg;
//!   globalThis.$RefreshSig$ = prevRefreshSig;
//! }
//! // <the async module wrapper's closing, if any>
//! ```
//!
//! `init` must run before React DOM does, so before the module requires its imports. The module's
//! code may declare its own `module`, which would shadow the module object: a `let` or `const` in
//! the `try` block, or a hoisted `var` or function, which inside an async module wrapper's function
//! starts out undefined. So the wrapper refers to the module object through an alias taken
//! outside of both.

use crate::runtime_modules::REACT_REFRESH;

/// The React Refresh wrapper as text, for generated code `code` (see the module docs).
pub struct RefreshWrapper {
  /// Goes before the module's code and any async module wrapper around it.
  pub outer: String,
  /// Goes just before the module's code.
  pub inner: String,
  /// Goes after the module's code, which ends with a newline.
  pub suffix: String,
}

/// The React Refresh wrapper for generated code `code`. Its names are ones `code` doesn't contain.
pub fn react_refresh_text(code: &str) -> RefreshWrapper {
  let helpers = unused_name(code, "$parcel$ReactRefreshHelpers");
  let module = unused_name(code, "$parcel$module");
  let prev_reg = unused_name(code, "prevRefreshReg");
  let prev_sig = unused_name(code, "prevRefreshSig");
  let specifier = serde_json::to_string(REACT_REFRESH).unwrap();
  RefreshWrapper {
    outer: format!(
      "var {helpers} = require({specifier});\n{helpers}.init();\nvar {module} = module;\n"
    ),
    inner: format!(
      "var {prev_reg} = globalThis.$RefreshReg$;\nvar {prev_sig} = globalThis.$RefreshSig$;\n{helpers}.prelude({module});\ntry {{\n"
    ),
    suffix: format!(
      "{helpers}.postlude({module});\n}} finally {{\nglobalThis.$RefreshReg$ = {prev_reg};\nglobalThis.$RefreshSig$ = {prev_sig};\n}}\n"
    ),
  }
}

/// `base`, or `base` with a numeric suffix, such that it doesn't occur in `code`, so it can't
/// collide with a binding there.
pub fn unused_name(code: &str, base: &str) -> String {
  if !code.contains(base) {
    return base.to_owned();
  }
  (1..)
    .map(|suffix| format!("{base}{suffix}"))
    .find(|name| !code.contains(name.as_str()))
    .unwrap()
}
