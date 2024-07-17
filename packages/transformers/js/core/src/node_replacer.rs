use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::Path;

use swc_core::common::sync::Lrc;
use swc_core::common::Mark;
use swc_core::common::SourceMap;
use swc_core::common::SyntaxContext;
use swc_core::common::DUMMY_SP;
use swc_core::ecma::ast;
use swc_core::ecma::atoms::JsWord;
use swc_core::ecma::utils::stack_size::maybe_grow_default;
use swc_core::ecma::visit::Fold;
use swc_core::ecma::visit::FoldWith;

use crate::dependency_collector::DependencyDescriptor;
use crate::dependency_collector::DependencyKind;
use crate::utils::create_global_decl_stmt;
use crate::utils::create_require;
use crate::utils::is_unresolved;
use crate::utils::SourceLocation;
use crate::utils::SourceType;

/// Replaces __filename and __dirname with globals that reference to string literals for the
/// file-path of this file.
///
/// This is coupled with the packager implementations in `ScopeHoistingPackager.js` and
/// `DevPackager.js` which handle inserting paths into this file through string replacement of
/// the `"$parcel$filenameReplace"` and `"$parcel$dirnameReplace"` string literals.
pub struct NodeReplacer<'a> {
  pub source_map: Lrc<SourceMap>,
  pub items: &'a mut Vec<DependencyDescriptor>,
  pub global_mark: Mark,
  pub globals: HashMap<JsWord, (SyntaxContext, ast::Stmt)>,
  pub filename: &'a Path,
  pub unresolved_mark: Mark,
  pub has_node_replacements: &'a mut bool,
}

impl<'a> Fold for NodeReplacer<'a> {
  fn fold_expr(&mut self, node: ast::Expr) -> ast::Expr {
    use ast::Expr::*;
    use ast::MemberExpr;
    use ast::MemberProp;

    // Do not traverse into the `prop` side of member expressions unless computed.
    let mut node = match node {
      Member(expr) => {
        if let MemberProp::Computed(_) = expr.prop {
          Member(MemberExpr {
            obj: expr.obj.fold_with(self),
            prop: expr.prop.fold_with(self),
            ..expr
          })
        } else {
          Member(MemberExpr {
            obj: expr.obj.fold_with(self),
            ..expr
          })
        }
      }
      _ => maybe_grow_default(|| node.fold_children_with(self)),
    };

    if let Ident(id) = &mut node {
      // Only handle global variables
      if !is_unresolved(&id, self.unresolved_mark) {
        return node;
      }

      let unresolved_mark = self.unresolved_mark;
      match id.sym.to_string().as_str() {
        "__filename" => {
          let specifier = swc_core::ecma::atoms::JsWord::from("path");
          let replace_me_value = swc_core::ecma::atoms::JsWord::from("$parcel$filenameReplace");

          let expr = |this: &NodeReplacer| {
            let filename = if let Some(name) = this.filename.file_name() {
              name
            } else {
              OsStr::new("unknown.js")
            };
            Call(ast::CallExpr {
              span: DUMMY_SP,
              type_args: None,
              args: vec![
                ast::ExprOrSpread {
                  spread: None,
                  expr: Box::new(ast::Expr::Ident(ast::Ident {
                    optional: false,
                    span: DUMMY_SP,
                    // This also uses __dirname as later in the path.join call the hierarchy is then correct
                    // Otherwise path.join(__filename, '..') would be one level to shallow (due to the /filename.js at the end)
                    sym: swc_core::ecma::atoms::JsWord::from("__dirname"),
                  })),
                },
                ast::ExprOrSpread {
                  spread: None,
                  expr: Box::new(ast::Expr::Lit(ast::Lit::Str(ast::Str {
                    span: DUMMY_SP,
                    value: replace_me_value,
                    raw: None,
                  }))),
                },
                ast::ExprOrSpread {
                  spread: None,
                  expr: Box::new(ast::Expr::Lit(ast::Lit::Str(ast::Str {
                    span: DUMMY_SP,
                    value: swc_core::ecma::atoms::JsWord::from(filename.to_string_lossy()),
                    raw: None,
                  }))),
                },
              ],
              callee: ast::Callee::Expr(Box::new(ast::Expr::Member(ast::MemberExpr {
                span: DUMMY_SP,
                obj: (Box::new(Call(create_require(specifier.clone(), unresolved_mark)))),
                prop: MemberProp::Ident(ast::Ident::new("resolve".into(), DUMMY_SP)),
              }))),
            })
          };
          if self.update_binding(id, "$parcel$__filename".into(), expr) {
            self.items.push(DependencyDescriptor {
              kind: DependencyKind::Require,
              loc: SourceLocation::from(&self.source_map, id.span),
              specifier,
              attributes: None,
              is_optional: false,
              is_helper: false,
              source_type: Some(SourceType::Module),
              placeholder: None,
            });

            *self.has_node_replacements = true;
          }
        }
        "__dirname" => {
          let specifier = swc_core::ecma::atoms::JsWord::from("path");
          let replace_me_value = swc_core::ecma::atoms::JsWord::from("$parcel$dirnameReplace");

          if self.update_binding(id, "$parcel$__dirname".into(), |_| {
            ast::Expr::Call(ast::CallExpr {
              span: DUMMY_SP,
              type_args: None,
              args: vec![
                ast::ExprOrSpread {
                  spread: None,
                  expr: Box::new(ast::Expr::Ident(ast::Ident {
                    optional: false,
                    span: DUMMY_SP,
                    sym: swc_core::ecma::atoms::JsWord::from("__dirname"),
                  })),
                },
                ast::ExprOrSpread {
                  spread: None,
                  expr: Box::new(ast::Expr::Lit(ast::Lit::Str(ast::Str {
                    span: DUMMY_SP,
                    value: replace_me_value,
                    raw: None,
                  }))),
                },
              ],
              callee: ast::Callee::Expr(Box::new(ast::Expr::Member(ast::MemberExpr {
                span: DUMMY_SP,
                obj: (Box::new(Call(create_require(specifier.clone(), unresolved_mark)))),
                prop: MemberProp::Ident(ast::Ident::new("resolve".into(), DUMMY_SP)),
              }))),
            })
          }) {
            self.items.push(DependencyDescriptor {
              kind: DependencyKind::Require,
              loc: SourceLocation::from(&self.source_map, id.span),
              specifier,
              attributes: None,
              is_optional: false,
              is_helper: false,
              source_type: Some(SourceType::Module),
              placeholder: None,
            });

            *self.has_node_replacements = true;
          }
        }
        _ => {}
      }
    }

    node
  }

  fn fold_module(&mut self, node: ast::Module) -> ast::Module {
    // Insert globals at the top of the program
    let mut node = swc_core::ecma::visit::fold_module(self, node);
    node.body.splice(
      0..0,
      self
        .globals
        .values()
        .map(|(_, stmt)| ast::ModuleItem::Stmt(stmt.clone())),
    );
    node
  }
}

impl NodeReplacer<'_> {
  fn update_binding<F>(&mut self, id_ref: &mut ast::Ident, new_name: JsWord, expr: F) -> bool
  where
    F: FnOnce(&Self) -> ast::Expr,
  {
    if let Some((ctxt, _)) = self.globals.get(&new_name) {
      id_ref.sym = new_name;
      id_ref.span.ctxt = *ctxt;
      false
    } else {
      id_ref.sym = new_name;

      let (decl, ctxt) = create_global_decl_stmt(id_ref.sym.clone(), expr(self), self.global_mark);
      id_ref.span.ctxt = ctxt;

      self.globals.insert(id_ref.sym.clone(), (ctxt, decl));
      true
    }
  }
}

#[cfg(test)]
mod test {
  use super::*;
  use crate::test_utils::run_fold;

  #[test]
  fn test_replace_filename() {
    let mut has_node_replacements = false;
    let mut items = vec![];

    let code = r#"
const filename = __filename;
console.log(__filename);
    "#;
    let output_code = run_fold(code, |context| NodeReplacer {
      source_map: context.source_map.clone(),
      global_mark: context.global_mark,
      globals: HashMap::new(),
      filename: Path::new("/path/random.js"),
      has_node_replacements: &mut has_node_replacements,
      items: &mut items,
      unresolved_mark: context.unresolved_mark,
    })
    .output_code;

    let expected_code = r#"
var $parcel$__filename = require("path").resolve(__dirname, "$parcel$filenameReplace", "random.js");
const filename = $parcel$__filename;
console.log($parcel$__filename);
"#
    .trim_start();
    assert_eq!(output_code, expected_code);
    assert_eq!(has_node_replacements, true);
    assert_eq!(items[0].specifier, JsWord::from("path"));
    assert_eq!(items[0].kind, DependencyKind::Require);
    assert_eq!(items[0].source_type, Some(SourceType::Module));
    assert_eq!(items.len(), 1);
  }

  #[test]
  fn test_replace_dirname() {
    let mut has_node_replacements = false;
    let mut items = vec![];

    let code = r#"
const dirname = __dirname;
console.log(__dirname);
    "#;
    let output_code = run_fold(code, |context| NodeReplacer {
      source_map: context.source_map.clone(),
      global_mark: context.global_mark,
      globals: HashMap::new(),
      filename: Path::new("/path/random.js"),
      has_node_replacements: &mut has_node_replacements,
      items: &mut items,
      unresolved_mark: context.unresolved_mark,
    })
    .output_code;

    let expected_code = r#"
var $parcel$__dirname = require("path").resolve(__dirname, "$parcel$dirnameReplace");
const dirname = $parcel$__dirname;
console.log($parcel$__dirname);
"#
    .trim_start();
    assert_eq!(output_code, expected_code);
    assert_eq!(has_node_replacements, true);
    assert_eq!(items[0].specifier, JsWord::from("path"));
    assert_eq!(items[0].kind, DependencyKind::Require);
    assert_eq!(items[0].source_type, Some(SourceType::Module));
    assert_eq!(items.len(), 1);
  }

  #[test]
  fn test_does_not_replace_if_variables_are_shadowed() {
    let mut has_node_replacements = false;
    let mut items = vec![];

    let code = r#"
function something(__filename, __dirname) {
    const filename = __filename;
    console.log(__filename);
    console.log(__dirname);
}
    "#;
    let output_code = run_fold(code, |context| NodeReplacer {
      source_map: context.source_map.clone(),
      global_mark: context.global_mark,
      globals: HashMap::new(),
      filename: Path::new("/path/random.js"),
      has_node_replacements: &mut has_node_replacements,
      items: &mut items,
      unresolved_mark: context.unresolved_mark,
    })
    .output_code;

    let expected_code = r#"
function something(__filename, __dirname) {
    const filename = __filename;
    console.log(__filename);
    console.log(__dirname);
}
"#
    .trim_start();
    assert_eq!(output_code, expected_code);
    assert_eq!(has_node_replacements, false);
    assert_eq!(items.len(), 0);
  }

  #[test]
  fn test_does_not_replace_filename_or_dirname_identifiers_randomly() {
    let mut has_node_replacements = false;
    let mut items = vec![];

    let code = r#"
const filename = obj.__filename;
    "#;
    let output_code = run_fold(code, |context| NodeReplacer {
      source_map: context.source_map.clone(),
      global_mark: context.global_mark,
      globals: HashMap::new(),
      filename: Path::new("/path/random.js"),
      has_node_replacements: &mut has_node_replacements,
      items: &mut items,
      unresolved_mark: context.unresolved_mark,
    })
    .output_code;

    let expected_code = r#"
const filename = obj.__filename;
"#
    .trim_start();
    assert_eq!(output_code, expected_code);
    assert_eq!(has_node_replacements, false);
    assert_eq!(items.len(), 0);
  }

  #[test]
  fn test_does_replace_filename_or_dirname_identifiers_on_member_props() {
    let mut has_node_replacements = false;
    let mut items = vec![];

    let code = r#"
const filename = obj[__filename];
    "#;
    let output_code = run_fold(code, |context| NodeReplacer {
      source_map: context.source_map.clone(),
      global_mark: context.global_mark,
      globals: HashMap::new(),
      filename: Path::new("/path/random.js"),
      has_node_replacements: &mut has_node_replacements,
      items: &mut items,
      unresolved_mark: context.unresolved_mark,
    })
    .output_code;

    let expected_code = r#"
var $parcel$__filename = require("path").resolve(__dirname, "$parcel$filenameReplace", "random.js");
const filename = obj[$parcel$__filename];
"#
    .trim_start();
    assert_eq!(output_code, expected_code);
    assert_eq!(has_node_replacements, true);
    assert_eq!(items.len(), 1);
  }
}
