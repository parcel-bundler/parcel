use std::{
  borrow::Cow,
  collections::{HashMap, HashSet},
};

use indexmap::IndexMap;
use swc_core::{
  common::{DUMMY_SP, Mark, SyntaxContext, util::take::Take},
  ecma::{
    ast::*,
    atoms::Atom as JsWord,
    minifier::option::{CompressOptions, MangleOptions, TopLevelOptions},
    visit::{Visit, VisitMut, VisitMutWith, VisitWith, noop_visit_type},
  },
  quote,
};

use crate::{
  runtime_modules::EsmHelpers,
  transformer::{
    Ast,
    utils::{is_unresolved, match_member_expr, match_property_name},
  },
};

#[derive(Debug, serde::Serialize)]
#[serde(untagged)]
pub enum Resolution<'a> {
  #[serde(serialize_with = "serialize_excluded")]
  Excluded,
  Asset(String),
  /// An asset whose exports are private (see `AssetSymbols::private_exports`), with the private
  /// name of each symbol the importer reads from it, and the names an `export *` of it copies its
  /// exports by, if the importer has one and is public (see `private_star_export_names`).
  #[serde(serialize_with = "serialize_private_asset")]
  PrivateAsset(String, Vec<(&'a str, String)>, Option<Vec<Option<&'a str>>>),
  Symbols(Vec<(&'a str, String, Cow<'a, str>)>),
  #[serde(serialize_with = "serialize_internalized")]
  Internalized(String),
  External(Cow<'a, str>),
  #[serde(serialize_with = "serialize_string")]
  String(Cow<'a, str>),
  /// The inlined content of a bundle, exposed as a Uint8Array.
  /// Only produced for library builds; the app packager uses a synthetic shim module instead.
  #[serde(serialize_with = "serialize_bytes")]
  Bytes(Vec<u8>),
  /// The inlined content of a bundle, exposed as a constructed CSSStyleSheet.
  /// Only produced for library builds; the app packager uses a synthetic shim module instead.
  #[serde(serialize_with = "serialize_string")]
  StyleSheet(Cow<'a, str>),
  CssModule(String, Vec<(&'a str, String)>),
}

fn serialize_excluded<S>(serializer: S) -> Result<S::Ok, S::Error>
where
  S: serde::Serializer,
{
  use serde::Serialize;
  false.serialize(serializer)
}

fn serialize_private_asset<S>(
  id: &String,
  _names: &[(&str, String)],
  _star_names: &Option<Vec<Option<&str>>>,
  serializer: S,
) -> Result<S::Ok, S::Error>
where
  S: serde::Serializer,
{
  use serde::Serialize;
  id.serialize(serializer)
}

fn serialize_string<S>(value: &Cow<'_, str>, serializer: S) -> Result<S::Ok, S::Error>
where
  S: serde::Serializer,
{
  use serde::Serialize;
  HashMap::from([("value", value)]).serialize(serializer)
}

fn serialize_bytes<S>(value: &Vec<u8>, serializer: S) -> Result<S::Ok, S::Error>
where
  S: serde::Serializer,
{
  use serde::Serialize;
  HashMap::from([("value", value)]).serialize(serializer)
}

fn serialize_internalized<S>(value: &String, serializer: S) -> Result<S::Ok, S::Error>
where
  S: serde::Serializer,
{
  use serde::Serialize;
  format!("i_{}", value).serialize(serializer)
}

/// A `new Uint8Array([...])` expression of the given bytes.
fn bytes_expr(bytes: &[u8]) -> Expr {
  let array = Expr::Array(ArrayLit {
    span: DUMMY_SP,
    elems: bytes
      .iter()
      .map(|byte| {
        Some(ExprOrSpread {
          spread: None,
          expr: Box::new(Expr::Lit(Lit::Num(Number {
            span: DUMMY_SP,
            value: *byte as f64,
            raw: None,
          }))),
        })
      })
      .collect(),
  });
  quote!("new Uint8Array($array)" as Expr, array: Expr = array)
}

/// An expression constructing a CSSStyleSheet with the given content.
fn stylesheet_expr(text: &str) -> Expr {
  quote!(
    "((sheet) => (sheet.replaceSync($text), sheet))(new CSSStyleSheet())" as Expr,
    text: Expr = text.into()
  )
}

pub fn tree_shake<'a>(
  ast: &mut Ast,
  mut used_symbols: HashSet<JsWord>,
  resolutions: IndexMap<String, Resolution<'a>>,
  minify: bool,
  is_library: bool,
  require_name: JsWord,
  export_names: HashMap<JsWord, JsWord>,
) {
  swc_core::common::GLOBALS.set(&*ast.globals, || {
    // A CommonJS module reading its own exports (e.g. `exports.foo` within `exports.bar`) needs
    // their assignments even when no importer uses them.
    if !used_symbols.is_empty() {
      let mut self_references = SelfReferences {
        names: HashSet::new(),
        unresolved_mark: ast.unresolved_mark,
        in_module_this: true,
      };
      ast.program.visit_with(&mut self_references);
      used_symbols.extend(self_references.names);
    }

    let private_imports = private_imports(&ast.program, &resolutions, ast.unresolved_mark);
    let wrapper_mark = Mark::new();
    let wrapper_ctxt = SyntaxContext::empty().apply_mark(wrapper_mark);
    let mut shake = TreeShake {
      used_symbols,
      export_names,
      private_imports,
      resolutions,
      unresolved_mark: ast.unresolved_mark,
      wrapper_mark,
      wrapper_ctxt,
      mutated: false,
      is_library,
      require_name,
      in_module_this: true,
    };

    if !minify {
      ast.program.visit_mut_with(&mut shake);
      return;
    }

    let module = std::mem::take(&mut ast.program);
    let mut wrapper = FnExpr {
      ident: None,
      function: Box::new(Function {
        params: vec![
          Ident::new("module".into(), DUMMY_SP, wrapper_ctxt).into(),
          Ident::new("exports".into(), DUMMY_SP, wrapper_ctxt).into(),
        ],
        body: Some(FunctionBody {
          stmts: module
            .body
            .into_iter()
            .map(|item| match item {
              ModuleItem::Stmt(stmt) => stmt,
              ModuleItem::ModuleDecl(_) => item.expect_stmt(),
            })
            .collect(),
          ..Default::default()
        }),
        ..Default::default()
      }),
    };

    // Visit the wrapper's children so its body is still treated as the module's top level.
    wrapper.function.visit_mut_children_with(&mut shake);

    let program = swc_core::ecma::minifier::optimize(
      Program::Module(Module {
        body: vec![ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(
          ExportDefaultDecl {
            span: DUMMY_SP,
            decl: DefaultDecl::Fn(wrapper),
          },
        ))],
        ..Default::default()
      }),
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
        top_level_mark: ast.global_mark,
        unresolved_mark: ast.unresolved_mark,
      },
    );

    let mut module = program.expect_module();
    if let ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(ExportDefaultDecl {
      decl: DefaultDecl::Fn(f),
      ..
    })) = std::mem::replace(&mut module.body[0], ModuleItem::Stmt(Stmt::dummy()))
    {
      module.body[0] = ModuleItem::Stmt(Stmt::Expr(ExprStmt {
        span: DUMMY_SP,
        expr: Box::new(Expr::Fn(f)),
      }));
    }

    ast.program = module;
  })
}

/// Collects the names of exports a CommonJS module reads from its own exports object through
/// `exports.foo`, `module.exports.foo` or top-level `this.foo`.
struct SelfReferences {
  names: HashSet<JsWord>,
  unresolved_mark: Mark,
  /// Whether `this` refers to the module's exports, i.e. outside of any function or class.
  in_module_this: bool,
}

impl SelfReferences {
  /// The export a member expression of the module's exports object refers to.
  fn export_name(&self, member: &MemberExpr) -> Option<JsWord> {
    let is_exports = match &*member.obj {
      Expr::Ident(ident) => &*ident.sym == "exports" && is_unresolved(ident, self.unresolved_mark),
      Expr::Member(obj) => match_member_expr(obj, vec!["module", "exports"], self.unresolved_mark),
      Expr::This(_) => self.in_module_this,
      _ => false,
    };
    if is_exports {
      match_property_name(member).map(|(name, _)| name)
    } else {
      None
    }
  }
}

impl Visit for SelfReferences {
  noop_visit_type!();

  fn visit_assign_expr(&mut self, node: &AssignExpr) {
    // Assigning an export isn't a read, unless the assignment also reads it (e.g. `+=`).
    if node.op == AssignOp::Assign
      && let AssignTarget::Simple(SimpleAssignTarget::Member(member)) = &node.left
      && self.export_name(member).is_some()
    {
      member.prop.visit_with(self);
    } else {
      node.left.visit_with(self);
    }
    node.right.visit_with(self);
  }

  fn visit_member_expr(&mut self, node: &MemberExpr) {
    if let Some(name) = self.export_name(node) {
      self.names.insert(name);
    }
    node.visit_children_with(self);
  }

  fn visit_function(&mut self, node: &Function) {
    let in_module_this = std::mem::replace(&mut self.in_module_this, false);
    node.visit_children_with(self);
    self.in_module_this = in_module_this;
  }

  fn visit_getter_prop(&mut self, node: &GetterProp) {
    let in_module_this = std::mem::replace(&mut self.in_module_this, false);
    node.visit_children_with(self);
    self.in_module_this = in_module_this;
  }

  fn visit_setter_prop(&mut self, node: &SetterProp) {
    let in_module_this = std::mem::replace(&mut self.in_module_this, false);
    node.visit_children_with(self);
    self.in_module_this = in_module_this;
  }

  fn visit_class(&mut self, node: &Class) {
    let in_module_this = std::mem::replace(&mut self.in_module_this, false);
    node.visit_children_with(self);
    self.in_module_this = in_module_this;
  }
}

struct TreeShake<'a> {
  used_symbols: HashSet<JsWord>,
  /// The private names of the module's exports (see `AssetSymbols::private_exports`), if any.
  export_names: HashMap<JsWord, JsWord>,
  /// The bindings of required modules whose exports are private (see `private_imports`).
  private_imports: PrivateImports,
  resolutions: IndexMap<String, Resolution<'a>>,
  unresolved_mark: Mark,
  wrapper_mark: Mark,
  wrapper_ctxt: SyntaxContext,
  mutated: bool,
  is_library: bool,
  require_name: JsWord,
  /// Whether `this` refers to the module's exports, i.e. outside of any function or class.
  in_module_this: bool,
}

impl<'a> TreeShake<'a> {
  fn require_ident(&self) -> Ident {
    Ident::new(
      self.require_name.clone(),
      DUMMY_SP,
      SyntaxContext::empty().apply_mark(self.unresolved_mark),
    )
  }

  /// The call to an ESM helper (e.g. `export`) that `node` is, if it is one.
  fn helper_call<'n>(&self, node: &'n mut Stmt, helper: EsmHelpers) -> Option<&'n mut CallExpr> {
    let Stmt::Expr(stmt) = node else {
      return None;
    };
    let Expr::Call(call) = &mut *stmt.expr else {
      return None;
    };
    let Callee::Expr(callee) = &call.callee else {
      return None;
    };
    let is_helper = matches!(&**callee, Expr::Ident(id)
      if id.sym == helper.function() && is_unresolved(id, self.unresolved_mark));
    is_helper.then_some(call)
  }

  /// Removes the exports nothing uses from a call to the ESM `export` helper and renames those
  /// whose names are private, returning whether it still defines any. It's either called with an
  /// object of getters by name, or a name and its getter (see `define_exports`).
  fn shake_exports(&mut self, call: &mut CallExpr) -> bool {
    let is_used = |name: &JsWord| self.used_symbols.is_empty() || self.used_symbols.contains(name);
    match call.args.get_mut(1).map(|arg| &mut *arg.expr) {
      Some(Expr::Object(object)) => {
        object.props.retain_mut(|prop| {
          let PropOrSpread::Prop(prop) = prop else {
            return true;
          };
          let Prop::KeyValue(KeyValueProp { key, .. }) = &mut **prop else {
            return true;
          };
          let name: JsWord = match key {
            PropName::Ident(name) => name.sym.clone(),
            PropName::Str(name) => name.value.to_atom_lossy().into_owned(),
            _ => return true,
          };
          if !is_used(&name) {
            return false;
          }
          if let Some(private) = self.export_names.get(&name) {
            *key = PropName::Ident(IdentName::new(private.clone(), DUMMY_SP));
          }
          true
        });
        !object.props.is_empty()
      }
      Some(Expr::Lit(Lit::Str(name))) => {
        let value = name.value.to_atom_lossy().into_owned();
        if let Some(private) = self.export_names.get(&value) {
          *name = private.as_str().into();
        }
        is_used(&value)
      }
      _ => true,
    }
  }
}

impl<'a> VisitMut for TreeShake<'a> {
  fn visit_mut_stmt(&mut self, node: &mut Stmt) {
    // Before visiting the call, which renames the helper it calls (see `visit_mut_ident`).
    if (!self.used_symbols.is_empty() || !self.export_names.is_empty())
      && let Some(call) = self.helper_call(node, EsmHelpers::EXPORT)
      && !self.shake_exports(call)
    {
      *node = Stmt::Empty(EmptyStmt { span: DUMMY_SP });
      self.mutated = true;
      return;
    }

    // An `export *` of a module whose exports are private copies them by their public names.
    if !self.private_imports.star_names.is_empty()
      && let Some(call) = self.helper_call(node, EsmHelpers::EXPORT_ALL)
      && let Some(Expr::Ident(source)) = call.args.first().map(|arg| &*arg.expr)
      && let Some(names) = self.private_imports.star_names.get(&source.to_id())
    {
      // An array of the names, with holes for those it doesn't copy.
      call.args.push(
        Expr::Array(ArrayLit {
          span: DUMMY_SP,
          elems: names
            .iter()
            .map(|name| name.clone().map(|name| Expr::from(Str::from(name)).into()))
            .collect(),
        })
        .into(),
      );
    }

    node.visit_mut_children_with(self);
    if self.used_symbols.is_empty() {
      return;
    }

    let Stmt::Expr(stmt) = node else { return };

    match &mut *stmt.expr {
      Expr::Assign(assign) => {
        if let AssignTarget::Simple(SimpleAssignTarget::Member(member)) = &assign.left {
          let name = match &*member.obj {
            Expr::Member(obj) => {
              if match_member_expr(obj, vec!["module", "exports"], self.wrapper_mark) {
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
              if &*ident.sym == "exports" && is_unresolved(&ident, self.wrapper_mark) {
                if let Some((name, _)) = match_property_name(&member) {
                  name
                } else {
                  return;
                }
              } else {
                return;
              }
            }
            // Top-level `this` in CommonJS is `exports`.
            Expr::This(_) if self.in_module_this => {
              if let Some((name, _)) = match_property_name(&member) {
                name
              } else {
                return;
              }
            }
            _ => return,
          };

          if !self.used_symbols.contains(&name) {
            stmt.expr = assign.right.take();
            self.mutated = true;
            return;
          }

          if let Some(private) = self.export_names.get(&name).cloned()
            && let AssignTarget::Simple(SimpleAssignTarget::Member(member)) = &mut assign.left
          {
            member.prop = MemberProp::Ident(IdentName::new(private, DUMMY_SP));
          }
        }
      }
      _ => {}
    }
  }

  fn visit_mut_member_expr(&mut self, node: &mut MemberExpr) {
    node.visit_mut_children_with(self);
    let Expr::Ident(obj) = &*node.obj else {
      return;
    };
    let Some(names) = self.private_imports.names.get(&obj.to_id()) else {
      return;
    };
    let private = match &node.prop {
      MemberProp::Ident(prop) => names.get(&prop.sym),
      MemberProp::Computed(ComputedPropName { expr, .. }) => match &**expr {
        Expr::Lit(Lit::Str(prop)) => names.get(&*prop.value.to_atom_lossy()),
        _ => None,
      },
      _ => None,
    };
    if let Some(private) = private {
      node.prop = MemberProp::Ident(IdentName::new(private.clone(), DUMMY_SP));
    }
  }

  fn visit_mut_function(&mut self, node: &mut Function) {
    let in_module_this = std::mem::replace(&mut self.in_module_this, false);
    node.visit_mut_children_with(self);
    self.in_module_this = in_module_this;
  }

  fn visit_mut_getter_prop(&mut self, node: &mut GetterProp) {
    let in_module_this = std::mem::replace(&mut self.in_module_this, false);
    node.visit_mut_children_with(self);
    self.in_module_this = in_module_this;
  }

  fn visit_mut_setter_prop(&mut self, node: &mut SetterProp) {
    let in_module_this = std::mem::replace(&mut self.in_module_this, false);
    node.visit_mut_children_with(self);
    self.in_module_this = in_module_this;
  }

  fn visit_mut_class(&mut self, node: &mut Class) {
    let in_module_this = std::mem::replace(&mut self.in_module_this, false);
    node.visit_mut_children_with(self);
    self.in_module_this = in_module_this;
  }

  fn visit_mut_expr(&mut self, node: &mut Expr) {
    node.visit_mut_children_with(self);
    match node {
      Expr::Call(call) => {
        match &call.callee {
          Callee::Import(_) => {}
          Callee::Expr(expr) if matches!(&**expr, Expr::Ident(id) if id.sym == self.require_name && is_unresolved(&id, self.unresolved_mark)) =>
            {}
          _ => return,
        };

        let Some(ExprOrSpread { expr, .. }) = call.args.get_mut(0) else {
          return;
        };

        let Expr::Lit(Lit::Str(specifier)) = &**expr else {
          return;
        };

        if let Some(resolution) = self
          .resolutions
          .get(specifier.value.to_string_lossy().as_ref())
        {
          match resolution {
            Resolution::Excluded => {
              *node = Expr::Object(Default::default());
            }
            Resolution::Asset(resolution) | Resolution::PrivateAsset(resolution, ..) => {
              **expr = resolution.clone().into();
            }
            Resolution::External(specifier) => {
              **expr = specifier.as_ref().into();
            }
            Resolution::Internalized(id) => {
              *node = quote!("Promise.resolve().then(()=>$require($id))" as Expr, require: Ident = self.require_ident(), id: Expr = id.clone().into());
            }
            Resolution::String(string) => {
              *node = string.clone().into_owned().into();
            }
            Resolution::Bytes(bytes) => {
              *node = bytes_expr(bytes);
            }
            Resolution::StyleSheet(text) => {
              *node = stylesheet_expr(text);
            }
            Resolution::Symbols(symbols) => {
              // A namespace resolution already contains every export from this dependency,
              // including symbols that were resolved to a more specific asset. Keep the
              // namespace object intact so its property getters preserve live bindings.
              if let Some((_, id, _)) = symbols.iter().find(|(key, _, _)| *key == "*") {
                **expr = id.clone().into();
                return;
              }

              *node = Expr::Object(ObjectLit {
                span: DUMMY_SP,
                props: symbols
                  .iter()
                  .map(|(key, id, exp)| {
                    let prop = if exp == "*" {
                      Prop::KeyValue(KeyValueProp {
                        key: PropName::Str((*key).into()),
                        value: Box::new(quote!(
                          "$require($id)" as Expr,
                          require: Ident = self.require_ident(),
                          id: Expr = id.clone().into()
                        )),
                      })
                    } else {
                      Prop::Getter(GetterProp {
                        span: DUMMY_SP,
                        key: PropName::Str((*key).into()),
                        function: Box::new(Function {
                          body: Some(FunctionBody {
                            stmts: if exp == "default" {
                              vec![
                                quote!(
                                  "var m = $require($id);" as Stmt,
                                  require: Ident = self.require_ident(),
                                  id: Expr = id.clone().into(),
                                ),
                                quote!("return m.__esModule ? m.default : m;" as Stmt),
                              ]
                            } else {
                              vec![quote!(
                                "return $require($id)[$exp];" as Stmt,
                                require: Ident = self.require_ident(),
                                id: Expr = id.clone().into(),
                                exp: Expr = exp.as_ref().into()
                              )]
                            },
                            ..Default::default()
                          }),
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
              let obj = Expr::Object(ObjectLit {
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
              if self.is_library {
                **expr = specifier.as_str().into();
                *node = Expr::Paren(ParenExpr {
                  span: DUMMY_SP,
                  expr: Box::new(Expr::Seq(SeqExpr {
                    span: DUMMY_SP,
                    exprs: vec![Box::new(node.clone()), Box::new(obj)],
                  })),
                });
              } else {
                *node = obj;
              }
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
          if let Some(resolution) = self
            .resolutions
            .get(import.src.value.to_string_lossy().as_ref())
          {
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
              Resolution::Bytes(bytes) => {
                let name = import
                  .specifiers
                  .iter()
                  .find(|s| s.is_default())
                  .map(|s| &s.as_default().unwrap().local);
                if let Some(name) = name {
                  *node = quote!("const $name = $value" as ModuleItem, name: Ident = name.clone(), value: Expr = bytes_expr(bytes));
                }
              }
              Resolution::StyleSheet(text) => {
                let name = import
                  .specifiers
                  .iter()
                  .find(|s| s.is_default())
                  .map(|s| &s.as_default().unwrap().local);
                if let Some(name) = name {
                  *node = quote!("const $name = $value" as ModuleItem, name: Ident = name.clone(), value: Expr = stylesheet_expr(text));
                }
              }
              Resolution::CssModule(specifier, object) => {
                import.src.value = specifier.as_str().into();
                import.src.raw = None;
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
                  import.specifiers.clear();
                  nodes.insert(i + 1, assign);
                }
              }
              _ => {}
            }
          }
        }
        ModuleItem::ModuleDecl(ModuleDecl::ExportAll(export)) => {
          if let Some(resolution) = self
            .resolutions
            .get(export.src.value.to_string_lossy().as_ref())
          {
            match resolution {
              Resolution::External(resolution) => {
                export.src.value = resolution.as_ref().into();
                export.src.raw = None;
              }
              Resolution::String(_string) => {
                // TODO
              }
              _ => {}
            }
          }
        }
        ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(export)) => {
          if let Some(src) = &mut export.src {
            if let Some(resolution) = self.resolutions.get(src.value.to_string_lossy().as_ref()) {
              match resolution {
                Resolution::External(resolution) => {
                  src.value = resolution.as_ref().into();
                  src.raw = None;
                }
                Resolution::String(_string) => {
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

  fn visit_mut_ident(&mut self, node: &mut Ident) {
    if (node.sym == "exports" || node.sym == "module") && is_unresolved(node, self.unresolved_mark)
    {
      node.ctxt = self.wrapper_ctxt;
    }

    if is_unresolved(node, self.unresolved_mark) {
      if node.sym == "require" {
        node.sym = self.require_name.clone();
      } else if !self.is_library
        && let Some((_, minified)) = EsmHelpers::from_function(&node.sym)
      {
        // Optimized app bundles define the helpers by their minified names. Libraries define them
        // by their full names (see `append_esm_helpers`).
        node.sym = minified.into();
      }
    }
  }
}

/// The bindings of required modules whose exports are private (see `Resolution::PrivateAsset`):
/// the `var x = require("...")` declarations that `esm2cjs` creates for imports (which are in a
/// wrapper function in async modules), and the default interop bindings it creates from them.
#[derive(Default)]
struct PrivateImports {
  /// The private names of the exports the module reads through each binding.
  names: HashMap<Id, HashMap<JsWord, JsWord>>,
  /// The names the module's `export *` of each binding copies its exports by, if it has one.
  star_names: HashMap<Id, Vec<Option<JsWord>>>,
}

fn private_imports(
  program: &Module,
  resolutions: &IndexMap<String, Resolution<'_>>,
  unresolved_mark: Mark,
) -> PrivateImports {
  let mut collector = PrivateImportNames {
    resolutions,
    unresolved_mark,
    imports: PrivateImports::default(),
  };
  if resolutions
    .values()
    .any(|resolution| matches!(resolution, Resolution::PrivateAsset(..)))
  {
    program.visit_with(&mut collector);
  }
  collector.imports
}

struct PrivateImportNames<'a, 'b> {
  resolutions: &'b IndexMap<String, Resolution<'a>>,
  unresolved_mark: Mark,
  imports: PrivateImports,
}

impl Visit for PrivateImportNames<'_, '_> {
  noop_visit_type!();

  fn visit_var_declarator(&mut self, decl: &VarDeclarator) {
    decl.visit_children_with(self);
    let (Pat::Ident(binding), Some(Expr::Call(call))) = (&decl.name, decl.init.as_deref()) else {
      return;
    };
    let Callee::Expr(callee) = &call.callee else {
      return;
    };
    let Expr::Ident(callee) = &**callee else {
      return;
    };
    if !is_unresolved(callee, self.unresolved_mark) {
      return;
    }
    let names = match call.args.first().map(|arg| &*arg.expr) {
      Some(Expr::Lit(Lit::Str(specifier))) if callee.sym == "require" => {
        match self
          .resolutions
          .get(specifier.value.to_string_lossy().as_ref())
        {
          Some(Resolution::PrivateAsset(_, names, star_names)) => {
            if let Some(star_names) = star_names {
              self.imports.star_names.insert(
                binding.id.to_id(),
                star_names
                  .iter()
                  .map(|name| name.map(JsWord::from))
                  .collect(),
              );
            }
            names
              .iter()
              .map(|(name, private)| (JsWord::from(*name), JsWord::from(private.as_str())))
              .collect()
          }
          _ => return,
        }
      }
      // Declared after the require it interops with.
      Some(Expr::Ident(required)) if callee.sym == EsmHelpers::INTEROP_DEFAULT.function() => {
        match self.imports.names.get(&required.to_id()) {
          Some(names) => names.clone(),
          None => return,
        }
      }
      _ => return,
    };
    self.imports.names.insert(binding.id.to_id(), names);
  }
}
