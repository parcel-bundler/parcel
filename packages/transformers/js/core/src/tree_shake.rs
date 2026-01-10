use std::collections::{HashMap, HashSet};

use swc_core::{
  common::{DUMMY_SP, Mark, util::take::Take},
  ecma::{
    ast::*,
    atoms::Atom as JsWord,
    minifier::option::{CompressOptions, MangleOptions, TopLevelOptions},
    transforms::base::fixer::fixer,
    visit::{VisitMut, VisitMutWith},
  },
  quote,
};

use crate::{
  Ast,
  utils::{is_unresolved, match_member_expr, match_property_name},
};

pub enum Resolution<'a> {
  Excluded,
  Asset(u32),
  Symbols(Vec<(&'a str, u32, &'a str)>),
  Bundle(u32),
  External(&'a str),
}

pub fn tree_shake<'a>(
  ast: &mut Ast,
  used_symbols: HashSet<JsWord>,
  resolutions: HashMap<JsWord, Resolution<'a>>,
) {
  swc_core::common::GLOBALS.set(&*ast.globals, || {
    let global_mark = Mark::fresh(Mark::root());
    let unresolved_mark = Mark::fresh(Mark::root());
    let mut shake = TreeShake {
      used_symbols,
      resolutions,
      unresolved_mark,
      mutated: false,
    };

    ast.program.visit_mut_with(&mut shake);

    let module = std::mem::take(&mut ast.program);
    let mut program = swc_core::ecma::minifier::optimize(
      Program::Module(module),
      ast.source_map.clone(),
      Some(&ast.comments),
      None,
      &swc_core::ecma::minifier::option::MinifyOptions {
        rename: true,
        compress: Some(CompressOptions {
          top_level: Some(TopLevelOptions { functions: true }),
          ..Default::default()
        }),
        mangle: Some(MangleOptions {
          top_level: Some(true),
          ..Default::default()
        }),
        ..Default::default()
      },
      &swc_core::ecma::minifier::option::ExtraOptions {
        mangle_name_cache: None,
        top_level_mark: global_mark,
        unresolved_mark,
      },
    );

    program.mutate(&mut fixer(Some(&ast.comments)));
    ast.program = program.expect_module();
  })
}

struct TreeShake<'a> {
  used_symbols: HashSet<JsWord>,
  resolutions: HashMap<JsWord, Resolution<'a>>,
  unresolved_mark: Mark,
  mutated: bool,
}

impl<'a> VisitMut for TreeShake<'a> {
  fn visit_mut_stmt(&mut self, node: &mut Stmt) {
    node.visit_mut_children_with(self);
    let Stmt::Expr(stmt) = node else { return };

    match &mut *stmt.expr {
      Expr::Assign(assign) => {
        if let AssignTarget::Simple(SimpleAssignTarget::Member(member)) = &assign.left {
          let name = match &*member.obj {
            Expr::Member(obj) => {
              if match_member_expr(obj, vec!["module", "exports"], self.unresolved_mark) {
                if let Some((name, _)) = match_property_name(&member) {
                  name
                } else {
                  return;
                }
              } else {
                return;
              }
            }
            Expr::Ident(ident) => {
              if &*ident.sym == "exports" && is_unresolved(&ident, self.unresolved_mark) {
                if let Some((name, _)) = match_property_name(&member) {
                  name
                } else {
                  return;
                }
              } else {
                return;
              }
            }
            _ => return,
          };

          if !self.used_symbols.contains(&name) {
            println!("TREE SHAKE {}", name);
            stmt.expr = assign.right.take();
            self.mutated = true;
            return;
          }
        }
      }
      Expr::Call(call) => {
        let Callee::Expr(expr) = &call.callee else {
          return;
        };
        let Expr::Member(member) = &**expr else {
          return;
        };

        if !(matches!(&*member.obj, Expr::Ident(id) if id.sym == "parcelHelpers")
          && matches!(match_property_name(&member), Some((name, _)) if name == "export"))
        {
          return;
        }

        let Some(ExprOrSpread { expr, .. }) = call.args.get(1) else {
          return;
        };

        let Expr::Lit(Lit::Str(name)) = &**expr else {
          return;
        };

        if !self.used_symbols.contains(&name.value) {
          println!("TREE SHAKE {}", name.value);
          *node = Stmt::Empty(EmptyStmt { span: DUMMY_SP });
          self.mutated = true;
        }
      }
      _ => {}
    }
  }

  fn visit_mut_expr(&mut self, node: &mut Expr) {
    node.visit_mut_children_with(self);
    match node {
      Expr::Call(call) => {
        let Callee::Expr(expr) = &mut call.callee else {
          return;
        };

        // if matches!(&*expr, Expr::Ident(id) if id.sym == "require" && is_unresolved(&id, self.unresolved_mark)) {
        if let Expr::Ident(id) = &mut **expr {
          if id.sym == "require"
          /*  && is_unresolved(&id, self.unresolved_mark) */
          {
            let Some(ExprOrSpread { expr, .. }) = call.args.get_mut(0) else {
              return;
            };

            let Expr::Lit(Lit::Str(specifier)) = &**expr else {
              return;
            };

            if let Some(resolution) = self.resolutions.get(&specifier.value) {
              id.sym = "parcelRequire".into();
              match resolution {
                Resolution::Excluded => {
                  *node = Expr::Object(Default::default());
                }
                Resolution::Asset(resolution) => {
                  **expr = (*resolution as f64).into();
                }
                Resolution::Bundle(resolution) => {
                  **expr = format!("b{}", *resolution).into();
                }
                Resolution::External(specifier) => {
                  **expr = (*specifier).into();
                }
                Resolution::Symbols(symbols) => {
                  **expr = Expr::Object(ObjectLit {
                    span: DUMMY_SP,
                    props: symbols
                      .iter()
                      .map(|(key, id, exp)| {
                        let prop = if *key == "*" {
                          todo!()
                        } else if *exp == "*" {
                          Prop::KeyValue(KeyValueProp {
                            key: PropName::Str((*key).into()),
                            value: Box::new(
                              quote!("parcelRequire($id)" as Expr, id: Expr = (*id as f64).into()),
                            ),
                          })
                        } else {
                          Prop::Getter(GetterProp {
                            span: DUMMY_SP,
                            key: PropName::Str((*key).into()),
                            type_ann: None,
                            body: Some(BlockStmt {
                              stmts: if *exp == "default" {
                                vec![
                                  quote!(
                                    "var m = parcelRequire($id);" as Stmt,
                                    id: Expr = (*id as f64).into(),
                                  ),
                                  quote!("return m.__esModule ? m.default : m;" as Stmt),
                                ]
                              } else {
                                vec![quote!(
                                  "return parcelRequire($id)[$exp];" as Stmt,
                                  id: Expr = (*id as f64).into(),
                                  exp: Expr = (*exp).into()
                                )]
                              },
                              ..Default::default()
                            }),
                          })
                        };

                        PropOrSpread::Prop(Box::new(prop))
                      })
                      .collect(),
                  });
                }
              }
            }
          }

          return;
        }
      }
      _ => {}
    }
  }
}
