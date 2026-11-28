use std::{
  borrow::Cow,
  cell::Cell,
  collections::{HashMap, HashSet},
};

use indexmap::IndexMap;
use swc_core::{
  common::{DUMMY_SP, Mark, SyntaxContext, util::take::Take},
  ecma::{
    ast::*,
    atoms::Atom as JsWord,
    minifier::option::{CompressOptions, MangleOptions, TopLevelOptions},
    visit::{Visit, VisitMut, VisitMutWith, VisitWith},
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

/// How a module is required.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize)]
#[serde(untagged)]
pub enum ModuleId<'a> {
  /// By its id in the module table, which any bundle can require.
  Global(Cow<'a, str>),
  /// By its index in its bundle's table of modules nothing outside the bundle refers to (see
  /// `LocalModules`).
  Local(u32),
}

impl<'a> From<&'a str> for ModuleId<'a> {
  fn from(id: &'a str) -> Self {
    ModuleId::Global(Cow::Borrowed(id))
  }
}

impl From<String> for ModuleId<'_> {
  fn from(id: String) -> Self {
    ModuleId::Global(Cow::Owned(id))
  }
}

impl From<&ModuleId<'_>> for Expr {
  fn from(id: &ModuleId<'_>) -> Self {
    match id {
      ModuleId::Global(id) => id.as_ref().into(),
      ModuleId::Local(index) => number_expr(*index),
    }
  }
}

/// The name, before minification, of the module wrapper's parameter that requires a module
/// relative to the wrapped one (see `TreeShake::relative_offset`).
const RELATIVE_REQUIRE: &str = "$parcel$requireRelative";

fn number_expr(value: u32) -> Expr {
  Expr::Lit(Lit::Num(Number {
    span: DUMMY_SP,
    value: value as f64,
    raw: None,
  }))
}

#[derive(Debug)]
pub enum ResolvedSymbol<'a> {
  EsmDefault,
  Symbol(&'a str),
}

impl<'a> serde::Serialize for ResolvedSymbol<'a> {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    match self {
      ResolvedSymbol::EsmDefault => "default".serialize(serializer),
      ResolvedSymbol::Symbol(s) => s.serialize(serializer),
    }
  }
}

#[derive(Debug, serde::Serialize)]
#[serde(untagged)]
pub enum Resolution<'a> {
  #[serde(serialize_with = "serialize_excluded")]
  Excluded,
  Asset(ModuleId<'a>),
  EsmAsset(ModuleId<'a>),
  Symbols(Vec<(&'a str, ModuleId<'a>, ResolvedSymbol<'a>)>),
  #[serde(serialize_with = "serialize_internalized")]
  Internalized(&'a str),
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

fn serialize_internalized<S>(value: &&str, serializer: S) -> Result<S::Ok, S::Error>
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
  used_symbols: HashSet<JsWord>,
  resolutions: IndexMap<String, Resolution<'a>>,
  minify: bool,
  is_library: bool,
  require_name: JsWord,
  // The module's number within its bundle, if it has one (see `LocalModules`).
  local_index: Option<u32>,
  // Whether nothing reads the module's `__esModule` flag, so it can be removed.
  unused_interop_flag: bool,
  // Whether the wrapper minified output is in may be an arrow function.
  arrow_wrapper: bool,
) -> EsmHelpers {
  swc_core::common::GLOBALS.set(&*ast.globals, || {
    let wrapper_mark = Mark::new();
    let wrapper_ctxt = SyntaxContext::empty().apply_mark(wrapper_mark);
    let mut shake = TreeShake {
      used_symbols,
      resolutions,
      unresolved_mark: ast.unresolved_mark,
      wrapper_mark,
      wrapper_ctxt,
      mutated: false,
      is_library,
      require_name,
      in_module_this: true,
      // Only the wrapper added below has the relative require.
      local_index: local_index.filter(|_| minify),
      unused_interop_flag,
      helpers: EsmHelpers::empty(),
      required: HashMap::new(),
      uses_relative_require: Cell::new(false),
    };

    if !minify {
      ast.program.visit_mut_with(&mut shake);
      return shake.helpers;
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
    if shake.uses_relative_require.get() {
      wrapper
        .function
        .params
        .push(shake.relative_require_ident().into());
    }

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
          ecma: EsVersion::Es2024, // TODO
          ..Default::default()
        }),
        mangle: Some(MangleOptions {
          top_level: Some(true),
          disable_char_freq: true,
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
        expr: Box::new(if arrow_wrapper {
          arrow_wrapper_expr(f)
        } else {
          Expr::Fn(f)
        }),
      }));
    }

    ast.program = module;
    shake.helpers
  })
}

/// The minified module wrapper as an arrow function, which is shorter, unless it has what an
/// arrow function would take from the code around it instead (`this` is the module's exports).
fn arrow_wrapper_expr(wrapper: FnExpr) -> Expr {
  let mut bindings = WrapperBindings { found: false };
  wrapper.function.visit_children_with(&mut bindings);
  let function = &*wrapper.function;
  if bindings.found
    || function.is_async
    || function.is_generator
    || function.body.is_none()
    || !function.decorators.is_empty()
    || function
      .params
      .iter()
      .any(|param| !param.decorators.is_empty())
  {
    return Expr::Fn(wrapper);
  }

  let function = *wrapper.function;
  Expr::Arrow(ArrowExpr {
    span: function.span,
    ctxt: function.ctxt,
    params: function.params.into_iter().map(|param| param.pat).collect(),
    body: Box::new(ArrowFunctionBody::FunctionBody(function.body.unwrap())),
    is_async: false,
    is_generator: false,
    type_params: None,
    return_type: None,
  })
}

/// Finds what a function binds that an arrow function doesn't: `this`, `arguments`, `new.target`
/// (and `super`, which a module's top level can't have).
struct WrapperBindings {
  found: bool,
}

impl Visit for WrapperBindings {
  // Other functions bind their own. Arrow functions, and what classes evaluate outside of their
  // methods, are visited.
  fn visit_function(&mut self, _: &Function) {}
  fn visit_constructor(&mut self, _: &Constructor) {}
  fn visit_getter_prop(&mut self, node: &GetterProp) {
    node.key.visit_with(self);
  }
  fn visit_setter_prop(&mut self, node: &SetterProp) {
    node.key.visit_with(self);
  }

  fn visit_this_expr(&mut self, _: &ThisExpr) {
    self.found = true;
  }

  fn visit_meta_prop_expr(&mut self, _: &MetaPropExpr) {
    self.found = true;
  }

  fn visit_ident(&mut self, node: &Ident) {
    if node.sym == "arguments" {
      self.found = true;
    }
  }
}

/// The known exports a variable holds (see `TreeShake::required`).
#[derive(Clone, Copy)]
enum Required {
  /// Those of a module with the `__esModule` flag.
  Flagged,
  /// The empty object an excluded module is replaced with.
  Excluded,
}

struct TreeShake<'a> {
  used_symbols: HashSet<JsWord>,
  resolutions: IndexMap<String, Resolution<'a>>,
  unresolved_mark: Mark,
  wrapper_mark: Mark,
  wrapper_ctxt: SyntaxContext,
  mutated: bool,
  is_library: bool,
  require_name: JsWord,
  /// Whether `this` refers to the module's exports, i.e. outside of any function or class.
  in_module_this: bool,
  /// The module's number within its bundle, if it has one (see `LocalModules`).
  local_index: Option<u32>,
  /// Whether nothing reads the module's `__esModule` flag (see `tree_shake`).
  unused_interop_flag: bool,
  /// The ESM helpers the module still calls.
  helpers: EsmHelpers,
  /// What the variables declared as a `require` call of a module with the `__esModule` flag, or
  /// of an excluded module, hold, as modules converted from ESM declare their imports before
  /// calling the interop helper with them (see `esm2cjs`).
  required: HashMap<Id, Required>,
  /// Whether the module requires another relative to its own number, so its wrapper needs the
  /// relative require as a parameter.
  uses_relative_require: Cell<bool>,
}

impl<'a> TreeShake<'a> {
  /// The wrapper's parameter that requires a module by its distance after this one in the
  /// bundle's numbered modules (see `runtime.js`).
  fn relative_require_ident(&self) -> Ident {
    Ident::new(RELATIVE_REQUIRE.into(), DUMMY_SP, self.wrapper_ctxt)
  }

  /// How far after this module `id` is numbered, if both are numbered within the bundle and `id`
  /// comes later. Modules are numbered in bundle order, where a module's dependencies tend to
  /// directly follow it, so modules that import alike require the same small distances rather
  /// than each naming different numbers, which compresses far better. Earlier modules are mostly
  /// ones many others share, which compress better under the one number everything requires.
  fn relative_offset(&self, id: &ModuleId<'_>) -> Option<u32> {
    match (self.local_index, id) {
      (Some(from), ModuleId::Local(to)) if *to > from => Some(to - from),
      _ => None,
    }
  }

  /// What a call to the default interop helper evaluates to, if what it's given is known: the
  /// exports of a module with the `__esModule` flag, as they are, or those of an excluded
  /// module. The minifier can't remove a call to the helper whose result is unused.
  fn static_interop(&self, node: &Expr) -> Option<Expr> {
    let Expr::Call(call) = node else {
      return None;
    };
    let Callee::Expr(callee) = &call.callee else {
      return None;
    };
    if !matches!(&**callee, Expr::Ident(id)
      if id.sym == EsmHelpers::INTEROP_DEFAULT.function() && is_unresolved(id, self.unresolved_mark))
    {
      return None;
    }
    let [ExprOrSpread { spread: None, expr }] = &call.args[..] else {
      return None;
    };
    let Expr::Ident(required) = &**expr else {
      return None;
    };
    match self.required.get(&required.to_id())? {
      Required::Flagged => Some(Expr::Ident(required.clone())),
      Required::Excluded => Some(quote!("({ default: {} })" as Expr)),
    }
  }

  /// Records what `decl` declares a variable to hold, if it's the exports of a module required
  /// with known exports (see `TreeShake::required`).
  fn record_required(&mut self, decl: &VarDeclarator) {
    let Pat::Ident(name) = &decl.name else {
      return;
    };
    let Some(Expr::Call(call)) = decl.init.as_deref() else {
      return;
    };
    let Callee::Expr(callee) = &call.callee else {
      return;
    };
    if !matches!(&**callee, Expr::Ident(id) if id.sym == "require" && is_unresolved(id, self.unresolved_mark))
    {
      return;
    }
    let [ExprOrSpread { spread: None, expr }] = &call.args[..] else {
      return;
    };
    let Expr::Lit(Lit::Str(specifier)) = &**expr else {
      return;
    };
    let required = match self
      .resolutions
      .get(specifier.value.to_string_lossy().as_ref())
    {
      Some(Resolution::EsmAsset(_)) => Required::Flagged,
      Some(Resolution::Excluded) => Required::Excluded,
      _ => return,
    };
    self.required.insert(name.to_id(), required);
  }

  /// Whether `node` defines the `__esModule` flag on the module's exports, and nothing reads it
  /// (see `AssetSymbols::exports_object_used`).
  fn is_unread_interop_flag(&self, node: &Stmt) -> bool {
    if !self.unused_interop_flag {
      return false;
    }
    let Stmt::Expr(stmt) = node else {
      return false;
    };
    let Expr::Call(call) = &*stmt.expr else {
      return false;
    };
    matches!(&call.callee, Callee::Expr(callee) if matches!(&**callee, Expr::Ident(id)
      if id.sym == EsmHelpers::DEFINE_INTEROP_FLAG.function()
        && is_unresolved(id, self.unresolved_mark)))
  }

  /// A call requiring the module `id`.
  fn require_call(&self, id: &ModuleId<'_>) -> Expr {
    match self.relative_offset(id) {
      Some(offset) => {
        self.uses_relative_require.set(true);
        quote!(
          "$require($offset)" as Expr,
          require: Ident = self.relative_require_ident(),
          offset: Expr = number_expr(offset)
        )
      }
      None => quote!(
        "$require($id)" as Expr,
        require: Ident = self.require_ident(),
        id: Expr = id.into()
      ),
    }
  }

  /// Makes a `require` call's callee and its argument `expr` require the module `id`.
  fn set_required(&self, callee: &mut Callee, expr: &mut Expr, id: &ModuleId<'_>) {
    // Only the runtime's require has a relative form; `import()` doesn't.
    if let Callee::Expr(_) = callee
      && let Some(offset) = self.relative_offset(id)
    {
      self.uses_relative_require.set(true);
      *callee = Callee::Expr(Box::new(self.relative_require_ident().into()));
      *expr = number_expr(offset);
    } else {
      *expr = id.into();
    }
  }

  fn require_ident(&self) -> Ident {
    Ident::new(
      self.require_name.clone(),
      DUMMY_SP,
      SyntaxContext::empty().apply_mark(self.unresolved_mark),
    )
  }

  /// Removes unused export getters from a call to the ESM export helper and returns whether the
  /// call still defines anything. See `define_exports` for the two forms of the call.
  fn retain_used_exports(&self, node: &mut Stmt) -> bool {
    let Stmt::Expr(stmt) = node else {
      return true;
    };
    let Expr::Call(call) = &mut *stmt.expr else {
      return true;
    };
    let Callee::Expr(callee) = &call.callee else {
      return true;
    };
    if !matches!(&**callee, Expr::Ident(id)
      if id.sym == EsmHelpers::EXPORT.function() && is_unresolved(id, self.unresolved_mark))
    {
      return true;
    }

    match call.args.get_mut(1).map(|arg| &mut *arg.expr) {
      Some(Expr::Object(object)) => {
        object.props.retain(|prop| {
          let PropOrSpread::Prop(prop) = prop else {
            return true;
          };
          match &**prop {
            Prop::KeyValue(KeyValueProp {
              key: PropName::Ident(name),
              ..
            }) => self.used_symbols.contains(&name.sym),
            Prop::KeyValue(KeyValueProp {
              key: PropName::Str(name),
              ..
            }) => self.used_symbols.contains(&name.value),
            _ => true,
          }
        });
        !object.props.is_empty()
      }
      Some(Expr::Lit(Lit::Str(name))) => self.used_symbols.contains(&name.value),
      _ => true,
    }
  }
}

impl<'a> VisitMut for TreeShake<'a> {
  fn visit_mut_stmt(&mut self, node: &mut Stmt) {
    // Before visiting the call, which renames the helper it calls (see `visit_mut_ident`).
    if self.is_unread_interop_flag(node)
      || (!self.used_symbols.is_empty() && !self.retain_used_exports(node))
    {
      *node = Stmt::Empty(EmptyStmt { span: DUMMY_SP });
      self.mutated = true;
      return;
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
        }
      }
      _ => {}
    }
  }

  fn visit_mut_var_declarator(&mut self, node: &mut VarDeclarator) {
    // Before visiting the call, which rewrites what it requires.
    self.record_required(node);
    node.visit_mut_children_with(self);
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
    // Before visiting the call, which renames the helper it calls (see `visit_mut_ident`).
    if let Some(value) = self.static_interop(node) {
      *node = value;
      return;
    }

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
            Resolution::Asset(resolution) | Resolution::EsmAsset(resolution) => {
              self.set_required(&mut call.callee, expr, resolution);
            }
            Resolution::External(specifier) => {
              **expr = specifier.as_ref().into();
            }
            Resolution::Internalized(id) => {
              *node = quote!("Promise.resolve().then(()=>$require($id))" as Expr, require: Ident = self.require_ident(), id: Expr = (*id).into());
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
                self.set_required(&mut call.callee, expr, id);
                return;
              }

              *node = Expr::Object(ObjectLit {
                span: DUMMY_SP,
                props: symbols
                  .iter()
                  .map(|(key, id, exp)| {
                    let prop = if matches!(exp, ResolvedSymbol::Symbol(exp) if *exp == "*") {
                      Prop::KeyValue(KeyValueProp {
                        key: PropName::Str((*key).into()),
                        value: Box::new(self.require_call(id)),
                      })
                    } else {
                      Prop::Getter(GetterProp {
                        span: DUMMY_SP,
                        key: PropName::Str((*key).into()),
                        function: Box::new(Function {
                          body: Some(FunctionBody {
                            stmts: match exp {
                              ResolvedSymbol::EsmDefault => {
                                vec![quote!(
                                  "return $required.default;" as Stmt,
                                  required: Expr = self.require_call(id),
                                )]
                              }
                              ResolvedSymbol::Symbol(exp) if *exp == "default" => {
                                vec![
                                  quote!(
                                    "var m = $required;" as Stmt,
                                    required: Expr = self.require_call(id),
                                  ),
                                  quote!("return m.__esModule ? m.default : m;" as Stmt),
                                ]
                              }
                              ResolvedSymbol::Symbol(exp) => {
                                vec![quote!(
                                  "return $required[$exp];" as Stmt,
                                  required: Expr = self.require_call(id),
                                  exp: Expr = (*exp).into()
                                )]
                              }
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
      } else if let Some((helper, name)) = EsmHelpers::from_function(&node.sym) {
        self.helpers |= helper;
        if !self.is_library {
          node.sym = name.into();
        }
      }
    }
  }
}
