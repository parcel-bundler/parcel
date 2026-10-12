//! Packaging for classic scripts, which run unwrapped so their top-level declarations are globals.

use indexmap::IndexMap;
use swc_core::{
  common::{Mark, SyntaxContext},
  ecma::{
    ast::*,
    atoms::Atom as JsWord,
    minifier::option::{CompressOptions, MangleOptions, MinifyOptions},
    visit::{VisitMut, VisitMutWith},
  },
};

use crate::{
  Ast,
  tree_shake::{Resolution, tree_shake},
};

/// Links a classic script's dependencies through the global `require_name`, the runtime's require
/// which a preceding module table registers. Only the `require` calls the transformer created for
/// them, identified by their placeholder specifiers, are replaced, so the script may still call a
/// global `require` of its own.
pub fn link_script<'a>(
  ast: &mut Ast,
  resolutions: IndexMap<String, Resolution<'a>>,
  require_name: JsWord,
) {
  swc_core::common::GLOBALS.set(&*ast.globals, || {
    ast.program.visit_mut_with(&mut RenameRequire {
      resolutions: &resolutions,
      unresolved_mark: ast.unresolved_mark,
      require_name: &require_name,
    });
  });
  tree_shake(
    ast,
    Default::default(),
    resolutions,
    false,
    false,
    require_name,
  );
}

struct RenameRequire<'a, 'b> {
  resolutions: &'b IndexMap<String, Resolution<'a>>,
  unresolved_mark: Mark,
  require_name: &'b JsWord,
}

impl VisitMut for RenameRequire<'_, '_> {
  fn visit_mut_call_expr(&mut self, call: &mut CallExpr) {
    call.visit_mut_children_with(self);
    let Callee::Expr(callee) = &mut call.callee else {
      return;
    };
    let Expr::Ident(ident) = &mut **callee else {
      return;
    };
    // The transformer's output has been through hygiene, so the call's context doesn't tell it
    // apart from a script's own `require`. Its placeholder specifier does.
    if ident.sym != "require" {
      return;
    }
    let Some(Expr::Lit(Lit::Str(specifier))) = call.args.first().map(|arg| &*arg.expr) else {
      return;
    };
    if self
      .resolutions
      .contains_key(specifier.value.to_string_lossy().as_ref())
    {
      *ident = Ident::new(
        self.require_name.clone(),
        ident.span,
        SyntaxContext::empty().apply_mark(self.unresolved_mark),
      );
    }
  }
}

/// Minifies a classic script. Its top-level declarations are globals other scripts may use, so they
/// keep their names and aren't removed when unused.
pub fn minify_script(ast: &mut Ast) {
  swc_core::common::GLOBALS.set(&*ast.globals, || {
    let module = std::mem::take(&mut ast.program);
    let script = Script {
      span: module.span,
      body: module
        .body
        .into_iter()
        .map(|item| item.expect_stmt())
        .collect(),
      shebang: module.shebang,
    };

    let program = swc_core::ecma::minifier::optimize(
      Program::Script(script),
      ast.source_map.clone(),
      Some(&ast.comments),
      None,
      &MinifyOptions {
        rename: true,
        compress: Some(CompressOptions {
          top_level: None,
          ..Default::default()
        }),
        mangle: Some(MangleOptions {
          top_level: Some(false),
          ..Default::default()
        }),
        ..Default::default()
      },
      &swc_core::ecma::minifier::option::ExtraOptions {
        mangle_name_cache: None,
        top_level_mark: ast.global_mark,
        unresolved_mark: ast.unresolved_mark,
      },
    );

    let script = program.expect_script();
    ast.program = Module {
      span: script.span,
      body: script.body.into_iter().map(ModuleItem::Stmt).collect(),
      shebang: script.shebang,
    };
  });
  ast.finalize();
}
