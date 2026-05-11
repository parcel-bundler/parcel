use std::{
  borrow::Cow,
  collections::{HashMap, HashSet},
};

use indexmap::IndexMap;
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

#[derive(Debug, serde::Serialize)]
#[serde(untagged)]
pub enum Resolution<'a> {
  #[serde(serialize_with = "serialize_excluded")]
  Excluded,
  Asset(u32),
  Symbols(Vec<(&'a str, u32, &'a str)>),
  #[serde(serialize_with = "serialize_bundle")]
  Bundle(u32),
  External(Cow<'a, str>),
  String(String),
  CssModule(String, Vec<(&'a str, String)>),
}

fn serialize_excluded<S>(serializer: S) -> Result<S::Ok, S::Error>
where
  S: serde::Serializer,
{
  use serde::Serialize;
  false.serialize(serializer)
}

fn serialize_bundle<S>(value: &u32, serializer: S) -> Result<S::Ok, S::Error>
where
  S: serde::Serializer,
{
  use serde::Serialize;
  format!("b{}", value).serialize(serializer)
}

pub fn tree_shake<'a>(
  ast: &mut Ast,
  used_symbols: HashSet<JsWord>,
  resolutions: IndexMap<String, Resolution<'a>>,
  dirname: JsWord,
  minify: bool,
) {
  swc_core::common::GLOBALS.set(&*ast.globals, || {
    let global_mark = Mark::fresh(Mark::root());
    let unresolved_mark = Mark::fresh(Mark::root());
    let mut shake = TreeShake {
      used_symbols,
      resolutions,
      unresolved_mark,
      dirname,
      mutated: false,
    };

    ast.program.visit_mut_with(&mut shake);

    // if minify {
    //   let module = std::mem::take(&mut ast.program);
    //   let mut program = swc_core::ecma::minifier::optimize(
    //     Program::Module(module),
    //     ast.source_map.clone(),
    //     Some(&ast.comments),
    //     None,
    //     &swc_core::ecma::minifier::option::MinifyOptions {
    //       rename: true,
    //       compress: Some(CompressOptions {
    //         top_level: Some(TopLevelOptions { functions: true }),
    //         ..Default::default()
    //       }),
    //       mangle: Some(MangleOptions {
    //         top_level: Some(true),
    //         ..Default::default()
    //       }),
    //       ..Default::default()
    //     },
    //     &swc_core::ecma::minifier::option::ExtraOptions {
    //       mangle_name_cache: None,
    //       top_level_mark: global_mark,
    //       unresolved_mark,
    //     },
    //   );

    //   program.mutate(&mut fixer(Some(&ast.comments)));
    //   ast.program = program.expect_module();
    // }
  })
}

struct TreeShake<'a> {
  used_symbols: HashSet<JsWord>,
  resolutions: IndexMap<String, Resolution<'a>>,
  unresolved_mark: Mark,
  dirname: JsWord,
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

          // if !self.used_symbols.contains(&name) {
          //   println!("TREE SHAKE {}", name);
          //   stmt.expr = assign.right.take();
          //   self.mutated = true;
          //   return;
          // }
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

        // if !self.used_symbols.contains(&name.value) {
        //   println!("TREE SHAKE {}", name.value);
        //   *node = Stmt::Empty(EmptyStmt { span: DUMMY_SP });
        //   self.mutated = true;
        // }
      }
      _ => {}
    }
  }

  fn visit_mut_expr(&mut self, node: &mut Expr) {
    node.visit_mut_children_with(self);
    match node {
      Expr::Call(call) => {
        match &call.callee {
          Callee::Import(_) => {}
          Callee::Expr(expr) if matches!(&**expr, Expr::Ident(id) if id.sym == "require") => {} // && is_unresolved(&id, self.unresolved_mark)
          _ => return,
        };

        let Some(ExprOrSpread { expr, .. }) = call.args.get_mut(0) else {
          return;
        };

        let Expr::Lit(Lit::Str(specifier)) = &**expr else {
          return;
        };

        if let Some(resolution) = self.resolutions.get(specifier.value.as_str()) {
          match resolution {
            Resolution::Excluded => {
              *node = Expr::Object(Default::default());
            }
            Resolution::Asset(resolution) => {
              call.callee = Callee::Expr(Box::new(Expr::Ident("parcelRequire".into())));
              **expr = (*resolution as f64).into();
            }
            Resolution::Bundle(resolution) => {
              call.callee = Callee::Expr(Box::new(Expr::Ident("parcelRequire".into())));
              **expr = format!("b{}", *resolution).into();
            }
            Resolution::External(specifier) => {
              **expr = specifier.as_ref().into();
            }
            Resolution::String(string) => {
              *node = string.as_str().into();
            }
            Resolution::Symbols(symbols) => {
              *node = Expr::Object(ObjectLit {
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
            Resolution::CssModule(specifier, object) => {
              **expr = specifier.as_str().into();
              *node = Expr::Paren(ParenExpr {
                span: DUMMY_SP,
                expr: Box::new(Expr::Seq(SeqExpr {
                  span: DUMMY_SP,
                  exprs: vec![
                    Box::new(node.clone()),
                    Box::new(Expr::Object(ObjectLit {
                      span: DUMMY_SP,
                      props: object
                        .iter()
                        .map(|(key, value)| {
                          let prop = Prop::KeyValue(KeyValueProp {
                            key: PropName::Str((*key).into()),
                            value: value.clone().into(),
                          });
                          PropOrSpread::Prop(Box::new(prop))
                        })
                        .collect(),
                    })),
                  ],
                })),
              });
            }
          }

          return;
        }
      }
      _ => {}
    }
  }

  fn visit_mut_module_items(&mut self, nodes: &mut Vec<ModuleItem>) {
    let mut i = 0;
    while i < nodes.len() {
      let node = &mut nodes[i];
      match node {
        ModuleItem::ModuleDecl(ModuleDecl::Import(import)) => {
          if let Some(resolution) = self.resolutions.get(import.src.value.as_str()) {
            match resolution {
              Resolution::External(specifier) => {
                import.src.value = specifier.as_ref().into();
                import.src.raw = None;
              }
              Resolution::String(string) => {
                let name = import
                  .specifiers
                  .iter()
                  .find(|s| s.is_default())
                  .map(|s| &s.as_default().unwrap().local);
                if let Some(name) = name {
                  *node = quote!("const $name = $value" as ModuleItem, name: Ident = name.clone(), value: Expr = string.clone().into());
                }
              }
              Resolution::CssModule(specifier, object) => {
                let name = import
                  .specifiers
                  .iter()
                  .find(|s| s.is_default())
                  .map(|s| &s.as_default().unwrap().local);
                if let Some(name) = name {
                  let value = Expr::Object(ObjectLit {
                    span: DUMMY_SP,
                    props: object
                      .iter()
                      .map(|(key, value)| {
                        let prop = Prop::KeyValue(KeyValueProp {
                          key: PropName::Str((*key).into()),
                          value: value.clone().into(),
                        });
                        PropOrSpread::Prop(Box::new(prop))
                      })
                      .collect(),
                  });
                  let assign = quote!("const $name = $value" as ModuleItem, name: Ident = name.clone(), value: Expr = value.into());
                  import.src.value = specifier.as_str().into();
                  import.src.raw = None;
                  import.specifiers.clear();
                  nodes.insert(i + 1, assign);
                }
              }
              _ => {}
            }
          }
        }
        ModuleItem::ModuleDecl(ModuleDecl::ExportAll(export)) => {
          if let Some(resolution) = self.resolutions.get(export.src.value.as_str()) {
            match resolution {
              Resolution::External(resolution) => {
                export.src.value = resolution.as_ref().into();
                export.src.raw = None;
              }
              Resolution::String(string) => {
                // TODO
              }
              _ => {}
            }
          }
        }
        ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(export)) => {
          if let Some(src) = &mut export.src {
            if let Some(resolution) = self.resolutions.get(src.value.as_str()) {
              match resolution {
                Resolution::External(resolution) => {
                  src.value = resolution.as_ref().into();
                  src.raw = None;
                }
                Resolution::String(string) => {
                  // TODO
                }
                _ => {}
              }
            }
          }
        }
        _ => node.visit_mut_children_with(self),
      }
      i += 1;
    }
  }

  fn visit_mut_str(&mut self, node: &mut Str) {
    if node.value == "$parcel$dirnameReplace" || node.value == "$parcel$filenameReplace" {
      node.value = self.dirname.clone();
    }
  }
}
