use std::collections::{HashMap, HashSet};

use parcel_core::{
  AssetFlags, AssetSymbols, ImportedSymbol, IndirectSymbol, LocalSymbol, StarSymbol, SymbolName,
  SymbolResolution,
};

use swc_core::{
  common::{DUMMY_SP, Mark, Span},
  ecma::{
    ast::*,
    atoms::Atom as JsWord,
    utils::stack_size::maybe_grow_default,
    visit::{Visit, VisitWith, noop_visit_type},
  },
};

use crate::transformer::{
  id,
  utils::{
    Bailout, BailoutReason, is_unresolved, match_export_name, match_export_name_ident,
    match_import, match_member_expr, match_property_name, match_require,
  },
};

macro_rules! collect_visit_fn {
  ($name:ident, $type:ident) => {
    fn $name(&mut self, node: &$type) {
      let in_module_this = self.in_module_this;
      let in_function = self.in_function;
      self.in_module_this = false;
      self.in_function = true;
      node.visit_children_with(self);
      self.in_module_this = in_module_this;
      self.in_function = in_function;
    }
  };
}

/// How a module is loaded.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum ImportKind {
  Import,
  Require,
  DynamicImport,
}

#[derive(Debug)]
pub struct Import {
  pub source: JsWord,
  pub specifier: JsWord,
  pub span: Span,
  pub kind: ImportKind,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Export {
  pub source: Option<JsWord>,
  pub specifier: JsWord,
  pub span: Span,
  pub is_esm: bool,
}

pub struct Collect {
  pub unresolved_mark: Mark,
  pub ignore_mark: Mark,
  pub static_cjs_exports: bool,
  pub has_cjs_exports: bool,
  pub is_esm: bool,
  pub should_wrap: bool,
  /// local variable binding -> descriptor
  pub imports: HashMap<Id, Import>,
  pub this_exprs: HashMap<JsWord, Span>,
  /// exported name -> descriptor
  pub exports: HashMap<JsWord, Export>,
  /// source of the export-all --> location
  pub exports_all: HashMap<JsWord, Span>,
  /// Referenced bindings, filtered to `imports` in `into_symbols`. These, `non_static_access`
  /// and `static_access` are recorded for every binding because a reference can be visited before
  /// the import that declares it, e.g. in a function declared above `const ns = await import()`.
  pub used_imports: HashSet<Id>,
  pub non_static_access: HashMap<Id, Vec<Span>>,
  /// binding -> statically accessed properties, e.g. `ns.foo`
  pub static_access: HashMap<Id, Vec<(JsWord, Span)>>,
  pub non_static_requires: HashSet<JsWord>,
  pub bailouts: Option<Vec<Bailout>>,
  in_module_this: bool,
  in_top_level: bool,
  in_export_decl: bool,
  in_function: bool,
  in_class: bool,
  is_module: bool,
}

impl Collect {
  pub fn new(
    unresolved_mark: Mark,
    ignore_mark: Mark,
    trace_bailouts: bool,
    is_module: bool,
  ) -> Self {
    Collect {
      unresolved_mark,
      ignore_mark,
      is_module,
      static_cjs_exports: true,
      has_cjs_exports: false,
      is_esm: false,
      should_wrap: false,
      imports: HashMap::new(),
      this_exprs: HashMap::new(),
      exports: HashMap::new(),
      exports_all: HashMap::new(),
      used_imports: HashSet::new(),
      non_static_access: HashMap::new(),
      static_access: HashMap::new(),
      non_static_requires: HashSet::new(),
      in_module_this: true,
      in_top_level: true,
      in_export_decl: false,
      in_function: false,
      in_class: false,
      bailouts: if trace_bailouts { Some(vec![]) } else { None },
    }
  }
}

impl Collect {
  /// Whether the module's imports and exports could be statically analyzed.
  pub fn is_static(&self) -> bool {
    self.static_cjs_exports && !self.should_wrap
  }

  /// Flags describing how the module exports its symbols.
  pub fn asset_flags(&self) -> AssetFlags {
    let mut flags = AssetFlags::empty();
    flags.set(AssetFlags::HAS_CJS_EXPORTS, self.has_cjs_exports);
    flags.set(AssetFlags::SHOULD_WRAP, self.should_wrap);
    flags.set(AssetFlags::IS_ESM, self.is_esm);
    flags.set(AssetFlags::STATIC_EXPORTS, self.static_cjs_exports);
    flags
  }

  /// The symbols the module imports and exports. `dep_index` returns the index of the dependency
  /// an import source refers to.
  pub fn into_symbols(self, dep_index: impl Fn(&JsWord) -> u32) -> AssetSymbols {
    let Collect {
      imports,
      used_imports,
      exports,
      exports_all,
      non_static_access,
      static_access,
      non_static_requires,
      has_cjs_exports,
      ..
    } = self;
    let mut symbols = AssetSymbols::default();

    // A namespace import or dynamic import that is only accessed statically (e.g. `ns.foo`)
    // imports just the accessed properties. Any other usage, e.g. a computed access, passing the
    // namespace around or re-assigning the binding, observes the whole namespace.
    let mut imported: Vec<(Span, &JsWord, &JsWord, &JsWord)> = Vec::new();
    for (local, import) in &imports {
      if !used_imports.contains(local) {
        continue;
      }

      if import.specifier == "*"
        && import.kind != ImportKind::Require
        && !non_static_access.contains_key(local)
        && let Some(accesses) = static_access.get(local)
      {
        let mut seen = HashSet::new();
        for (name, span) in accesses {
          if seen.insert(name) {
            imported.push((*span, name, &import.source, name));
          }
        }
      } else {
        imported.push((import.span, &local.0, &import.source, &import.specifier));
      }
    }

    // The collect maps are HashMaps, so sort by source location to keep symbol
    // order deterministic across builds (it flows into asset symbols and output).
    imported.sort_by(|(a_span, a_name, ..), (b_span, b_name, ..)| {
      (a_span.lo, a_name).cmp(&(b_span.lo, b_name))
    });
    symbols.imports = imported
      .into_iter()
      .map(|(_, _, source, symbol)| ImportedSymbol {
        dep_index: dep_index(source),
        symbol: SymbolName::from(symbol.as_str()),
        resolved: SymbolResolution::None,
      })
      .collect();

    let mut exports: Vec<_> = exports.into_iter().collect();
    exports.sort_by(|(a_exported, a), (b_exported, b)| {
      (a.span.lo, a_exported).cmp(&(b.span.lo, b_exported))
    });
    for (exported, export) in exports {
      let exported = SymbolName::from(exported.as_str());
      match export.source {
        Some(source) => symbols.indirect.push(IndirectSymbol {
          exported,
          dep_index: dep_index(&source),
          imported: SymbolName::from(export.specifier.as_str()),
          requested: false,
        }),
        None => symbols.exports.push(LocalSymbol {
          exported,
          requested: false,
        }),
      }
    }

    // Add * symbol if there are any CJS exports so that unknown symbols don't cause errors (e.g. default interop).
    if has_cjs_exports {
      symbols.exports.push(LocalSymbol {
        exported: SymbolName::Namespace,
        requested: false,
      });
    }

    let mut exports_all: Vec<_> = exports_all.into_iter().collect();
    exports_all.sort_by(|(a_source, a), (b_source, b)| (a.lo, a_source).cmp(&(b.lo, b_source)));
    symbols.star = exports_all
      .into_iter()
      .map(|(source, _)| StarSymbol {
        dep_index: dep_index(&source),
        requested: false,
      })
      .collect();

    // Unknown require or dynamic import usage must retain the full namespace because any export
    // could be observed at runtime.
    let mut non_static_requires: Vec<_> = non_static_requires.into_iter().collect();
    non_static_requires.sort();
    for source in non_static_requires {
      import_namespace(&mut symbols, dep_index(&source));
    }

    symbols
  }
}

/// Imports the namespace of a dependency, unless it is already imported.
pub fn import_namespace(symbols: &mut AssetSymbols, dep_index: u32) {
  if !symbols
    .imports
    .iter()
    .any(|symbol| symbol.dep_index == dep_index && symbol.symbol == SymbolName::Namespace)
  {
    symbols.imports.push(ImportedSymbol {
      dep_index,
      symbol: SymbolName::Namespace,
      resolved: SymbolResolution::None,
    });
  }
}

impl Visit for Collect {
  fn visit_module(&mut self, node: &Module) {
    self.in_module_this = true;
    self.in_top_level = true;
    self.in_function = false;
    // Visit all imports first so that all imports are known when visiting the rest of the module
    for n in &node.body {
      if n.is_module_decl() {
        n.visit_with(self);
      }
    }
    for n in &node.body {
      if !n.is_module_decl() {
        n.visit_with(self);
      }
    }
    self.in_module_this = false;

    for (key, span) in std::mem::take(&mut self.this_exprs) {
      if self.exports.contains_key(&key) {
        self.should_wrap = true;
        self.add_bailout(span, BailoutReason::ThisInExport);
      }
    }

    if let Some(bailouts) = &mut self.bailouts {
      for (key, Import { specifier, .. }) in &self.imports {
        if specifier == "*" {
          if let Some(spans) = self.non_static_access.get(key) {
            for span in spans {
              bailouts.push(Bailout {
                span: *span,
                reason: BailoutReason::NonStaticAccess,
              })
            }
          }
        }
      }

      bailouts.sort_by_key(|bailout| bailout.span.lo);
    }
  }

  collect_visit_fn!(visit_function, Function);
  collect_visit_fn!(visit_getter_prop, GetterProp);
  collect_visit_fn!(visit_setter_prop, SetterProp);

  fn visit_arrow_expr(&mut self, node: &ArrowExpr) {
    let in_function = self.in_function;
    self.in_function = true;
    node.visit_children_with(self);
    self.in_function = in_function;
  }

  fn visit_module_item(&mut self, node: &ModuleItem) {
    match node {
      ModuleItem::ModuleDecl(_decl) => {
        self.is_esm = true;
      }
      ModuleItem::Stmt(stmt) => {
        match stmt {
          Stmt::Decl(decl) => {
            if let Decl::Var(_var) = decl {
              decl.visit_children_with(self);
              return;
            }
          }
          Stmt::Expr(expr) => {
            // Top-level require(). Do not traverse further so it is not marked as wrapped.
            if let Some(_source) = self.match_require(&expr.expr) {
              return;
            }

            // TODO: optimize `require('foo').bar` / `require('foo').bar()` as well
          }
          _ => {}
        }
      }
    }

    self.in_top_level = false;
    node.visit_children_with(self);
    self.in_top_level = true;
  }

  fn visit_import_decl(&mut self, node: &ImportDecl) {
    for specifier in &node.specifiers {
      match specifier {
        ImportSpecifier::Named(named) => {
          let imported = match &named.imported {
            Some(imported) => match_export_name(imported).0.clone(),
            None => named.local.sym.clone(),
          };
          self.imports.insert(
            id!(named.local),
            Import {
              source: node.src.value.to_string_lossy().into(),
              specifier: imported,
              span: named.span,
              kind: ImportKind::Import,
            },
          );
        }
        ImportSpecifier::Default(default) => {
          self.imports.insert(
            id!(default.local),
            Import {
              source: node.src.value.to_string_lossy().into(),
              specifier: "default".into(),
              span: default.span,
              kind: ImportKind::Import,
            },
          );
        }
        ImportSpecifier::Namespace(namespace) => {
          self.imports.insert(
            id!(namespace.local),
            Import {
              source: node.src.value.to_string_lossy().into(),
              specifier: "*".into(),
              span: namespace.span,
              kind: ImportKind::Import,
            },
          );
        }
      }
    }
  }

  fn visit_named_export(&mut self, node: &NamedExport) {
    for specifier in &node.specifiers {
      let source = node
        .src
        .as_ref()
        .map(|s| -> JsWord { s.value.to_string_lossy().into() });
      match specifier {
        ExportSpecifier::Named(named) => {
          let exported = match &named.exported {
            Some(exported) => match_export_name(exported),
            None => match_export_name(&named.orig),
          };
          let orig = match_export_name_ident(&named.orig);
          let is_reexport = if source.is_none() {
            // import {foo} from "xyz";
            // export {foo};
            self.imports.get(&id!(orig))
          } else {
            None
          };
          let (source, specifier) = if let Some(reexport) = is_reexport {
            (Some(reexport.source.clone()), reexport.specifier.clone())
          } else {
            (source, orig.sym.clone())
          };
          self.exports.insert(
            exported.0.clone(),
            Export {
              specifier,
              span: exported.1,
              source,
              is_esm: true,
            },
          );
        }
        ExportSpecifier::Default(default) => {
          self.exports.insert(
            default.exported.sym.clone(),
            Export {
              specifier: "default".into(),
              span: default.exported.span,
              source,
              is_esm: true,
            },
          );
        }
        ExportSpecifier::Namespace(namespace) => {
          self.exports.insert(
            match_export_name(&namespace.name).0,
            Export {
              specifier: "*".into(),
              span: namespace.span,
              source,
              is_esm: true,
            },
          );
        }
      }
    }
  }

  fn visit_export_decl(&mut self, node: &ExportDecl) {
    match &node.decl {
      Decl::Class(class) => {
        self.exports.insert(
          class.ident.sym.clone(),
          Export {
            specifier: class.ident.sym.clone(),
            span: class.ident.span,
            source: None,
            is_esm: true,
          },
        );
      }
      Decl::Fn(func) => {
        self.exports.insert(
          func.ident.sym.clone(),
          Export {
            specifier: func.ident.sym.clone(),
            span: func.ident.span,
            source: None,
            is_esm: true,
          },
        );
      }
      Decl::Var(var) => {
        for decl in &var.decls {
          self.in_export_decl = true;
          decl.name.visit_with(self);
          self.in_export_decl = false;

          decl.init.visit_with(self);
        }
      }
      _ => {}
    }

    node.visit_children_with(self);
  }

  fn visit_export_default_decl(&mut self, node: &ExportDefaultDecl) {
    match &node.decl {
      DefaultDecl::Class(class) => {
        if let Some(ident) = &class.ident {
          self.exports.insert(
            "default".into(),
            Export {
              specifier: ident.sym.clone(),
              span: node.span,
              source: None,
              is_esm: true,
            },
          );
        } else {
          self.exports.insert(
            "default".into(),
            Export {
              specifier: "default".into(),
              span: node.span,
              source: None,
              is_esm: true,
            },
          );
        }
      }
      DefaultDecl::Fn(func) => {
        if let Some(ident) = &func.ident {
          self.exports.insert(
            "default".into(),
            Export {
              specifier: ident.sym.clone(),
              span: node.span,
              source: None,
              is_esm: true,
            },
          );
        } else {
          self.exports.insert(
            "default".into(),
            Export {
              specifier: "default".into(),
              span: node.span,
              source: None,
              is_esm: true,
            },
          );
        }
      }
      _ => {
        unreachable!("unsupported export default declaration");
      }
    };

    node.visit_children_with(self);
  }

  fn visit_export_default_expr(&mut self, node: &ExportDefaultExpr) {
    self.exports.insert(
      "default".into(),
      Export {
        specifier: "default".into(),
        span: node.span,
        source: None,
        is_esm: true,
      },
    );

    node.visit_children_with(self);
  }

  fn visit_export_all(&mut self, node: &ExportAll) {
    self
      .exports_all
      .insert(node.src.value.to_string_lossy().into(), node.span);
  }

  fn visit_return_stmt(&mut self, node: &ReturnStmt) {
    if !self.in_function {
      self.should_wrap = true;
      self.add_bailout(node.span, BailoutReason::TopLevelReturn);
    }

    node.visit_children_with(self)
  }

  fn visit_binding_ident(&mut self, node: &BindingIdent) {
    if self.in_export_decl {
      self.exports.insert(
        node.id.sym.clone(),
        Export {
          specifier: node.id.sym.clone(),
          span: node.id.span,
          source: None,
          is_esm: true,
        },
      );
    }
  }

  fn visit_assign_pat_prop(&mut self, node: &AssignPatProp) {
    if self.in_export_decl {
      self.exports.insert(
        node.key.sym.clone(),
        Export {
          specifier: node.key.sym.clone(),
          span: node.key.span,
          source: None,
          is_esm: true,
        },
      );
    }

    node.value.visit_with(self);
  }

  fn visit_member_expr(&mut self, node: &MemberExpr) {
    // if module.exports, ensure only assignment or static member expression
    // if exports, ensure only static member expression
    // if require, could be static access (handle in fold)

    if match_member_expr(node, vec!["module", "exports"], self.unresolved_mark) {
      self.static_cjs_exports = false;
      self.has_cjs_exports = true;
      return;
    }

    if match_member_expr(node, vec!["module", "hot"], self.unresolved_mark) {
      return;
    }

    if match_member_expr(node, vec!["module", "require"], self.unresolved_mark) {
      return;
    }

    macro_rules! handle_export {
      () => {
        self.has_cjs_exports = true;
        if let Some((name, span)) = match_property_name(&node) {
          self.exports.insert(
            name.clone(),
            Export {
              specifier: name,
              source: None,
              span: span,
              is_esm: false,
            },
          );
        } else {
          self.static_cjs_exports = false;
          self.add_bailout(node.span, BailoutReason::NonStaticExports);
        }
      };
    }

    match &*node.obj {
      Expr::Member(member) => {
        if match_member_expr(member, vec!["module", "exports"], self.unresolved_mark) {
          handle_export!();
          return;
        } else {
          member.visit_with(self);
        }
      }
      Expr::Ident(ident) => {
        if &*ident.sym == "exports" && is_unresolved(&ident, self.unresolved_mark) {
          handle_export!();
        } else if ident.sym == "module" && is_unresolved(&ident, self.unresolved_mark) {
          self.has_cjs_exports = true;
          self.static_cjs_exports = false;
          self.should_wrap = true;
          self.add_bailout(node.span, BailoutReason::FreeModule);
        } else if let Some((name, _)) = match_property_name(node) {
          self
            .static_access
            .entry(id!(ident))
            .or_default()
            .push((name, node.span));
        } else {
          self
            .non_static_access
            .entry(id!(ident))
            .or_default()
            .push(node.span);
        }
        self.used_imports.insert(id!(ident));
        // Visit computed property keys so imported symbols used there are tracked.
        if let MemberProp::Computed(_) = &node.prop {
          node.prop.visit_with(self);
        }
        return;
      }
      Expr::This(_this) => {
        if self.in_module_this {
          if !self.is_module {
            handle_export!();
          }
        } else if !self.in_class {
          if let MemberProp::Ident(prop) = &node.prop {
            self.this_exprs.insert(prop.sym.clone(), node.span);
          }
        }
        // Visit computed property keys so imported symbols used there are tracked.
        if let MemberProp::Computed(_) = &node.prop {
          node.prop.visit_with(self);
        }
        return;
      }
      _ => {}
    }

    node.visit_children_with(self);
  }

  fn visit_unary_expr(&mut self, node: &UnaryExpr) {
    if node.op == UnaryOp::TypeOf {
      match &*node.arg {
        Expr::Ident(ident)
          if ident.sym == "module" && is_unresolved(&ident, self.unresolved_mark) =>
        {
          // Do nothing to avoid the ident visitor from marking the module as non-static.
        }
        _ => node.visit_children_with(self),
      }
    } else {
      node.visit_children_with(self);
    }
  }

  fn visit_expr(&mut self, node: &Expr) {
    // If we reached this visitor, this is a non-top-level require that isn't in a variable
    // declaration. We need to wrap the referenced module to preserve side effect ordering.
    if self.match_require(node).is_some() {
      let span = match node {
        Expr::Call(c) => c.span,
        _ => unreachable!(),
      };
      self.add_bailout(span, BailoutReason::NonTopLevelRequire);
    }

    if let Some(source) = match_import(node) {
      self.non_static_requires.insert(source.clone());
      let span = match node {
        Expr::Call(c) => c.span,
        _ => unreachable!(),
      };
      self.add_bailout(span, BailoutReason::NonStaticDynamicImport);
    }

    match node {
      Expr::Ident(ident) => {
        // Bail if `module` or `exports` are accessed non-statically.
        let is_module = ident.sym == "module";
        let is_exports = &*ident.sym == "exports";
        if (is_module || is_exports) && is_unresolved(&ident, self.unresolved_mark) {
          self.has_cjs_exports = true;
          self.static_cjs_exports = false;
          if is_module {
            self.should_wrap = true;
            self.add_bailout(ident.span, BailoutReason::FreeModule);
          } else {
            self.add_bailout(ident.span, BailoutReason::FreeExports);
          }
        }

        self
          .non_static_access
          .entry(id!(ident))
          .or_default()
          .push(ident.span);

        self.used_imports.insert(id!(ident));
      }
      _ => {
        maybe_grow_default(|| node.visit_children_with(self));
      }
    }
  }

  fn visit_ident(&mut self, node: &Ident) {
    // This visitor helps us identify used imports in cases like:
    //
    //   import { foo } from "bar";
    //   const baz = { foo };
    self.used_imports.insert(id!(node));
  }

  fn visit_class(&mut self, class: &Class) {
    let in_module_this = self.in_module_this;
    let in_function = self.in_function;
    let in_class = self.in_class;

    self.in_module_this = false;
    self.in_function = true;
    self.in_class = true;

    class.visit_children_with(self);
    self.in_module_this = in_module_this;
    self.in_function = in_function;
    self.in_class = in_class;
  }

  fn visit_this_expr(&mut self, node: &ThisExpr) {
    if !self.is_module && self.in_module_this {
      self.has_cjs_exports = true;
      self.static_cjs_exports = false;
      self.add_bailout(node.span, BailoutReason::FreeExports);
    }
  }

  fn visit_assign_expr(&mut self, node: &AssignExpr) {
    // if rhs is a require, record static accesses
    // if lhs is `exports`, mark as CJS exports re-assigned
    // if lhs is `module.exports`
    // if lhs is `module.exports.XXX` or `exports.XXX`, record static export

    node.left.visit_with(self);
    node.right.visit_with(self);
    self.add_reassigned_namespaces(&node.left);

    if has_binding_identifier(&node.left, &"exports".into(), self.unresolved_mark) {
      // Must wrap for cases like
      // ```
      // function logExports() {
      //   console.log(exports);
      // }
      // exports.test = 2;
      // logExports();
      // exports = {test: 4};
      // logExports();
      // ```
      self.static_cjs_exports = false;
      self.has_cjs_exports = true;
      self.should_wrap = true;
      self.add_bailout(node.span, BailoutReason::ExportsReassignment);
    } else if has_binding_identifier(&node.left, &"module".into(), self.unresolved_mark) {
      // Same for `module`. If it is reassigned we can't correctly statically analyze.
      self.static_cjs_exports = false;
      self.has_cjs_exports = true;
      self.should_wrap = true;
      self.add_bailout(node.span, BailoutReason::ModuleReassignment);
    }
  }

  fn visit_var_declarator(&mut self, node: &VarDeclarator) {
    // if init is a require call, record static accesses
    if let Some(init) = &node.init {
      if let Some(source) = self.match_require(init) {
        self.add_pat_imports(&node.name, &source, ImportKind::Require);
        return;
      }

      match &**init {
        Expr::Member(member) => {
          if let Some(source) = self.match_require(&member.obj) {
            // Convert member expression on require to a destructuring assignment.
            // const yx = require('y').x; -> const {x: yx} = require('x');
            let key = match &member.prop {
              MemberProp::Computed(_) => PropName::Computed(ComputedPropName {
                span: DUMMY_SP,
                expr: Box::new(*member.obj.clone()),
              }),
              MemberProp::Ident(ident) => PropName::Ident(ident.clone()),
              _ => unreachable!(),
            };

            self.add_pat_imports(
              &Pat::Object(ObjectPat {
                optional: false,
                span: DUMMY_SP,
                type_ann: None,
                props: vec![ObjectPatProp::KeyValue(KeyValuePatProp {
                  key,
                  value: Box::new(node.name.clone()),
                })],
              }),
              &source,
              ImportKind::Require,
            );
            return;
          }
        }
        Expr::Await(await_exp) => {
          // let x = await import('foo');
          // let {x} = await import('foo');
          if let Some(source) = match_import(&await_exp.arg) {
            self.add_pat_imports(&node.name, &source, ImportKind::DynamicImport);
            return;
          }
        }
        _ => {}
      }
    }

    // e.g. `var ns = await import('foo'); var ns = other;`
    self.add_reassigned_namespaces(&node.name);

    // This is visited via visit_module_item with is_top_level == true, it needs to be
    // set to false for called visitors (and restored again).
    let in_top_level = self.in_top_level;
    self.in_top_level = false;
    node.visit_children_with(self);
    self.in_top_level = in_top_level;
  }

  fn visit_prop(&mut self, node: &Prop) {
    // `{ns}` observes the whole namespace, like `{ns: ns}`.
    if let Prop::Shorthand(ident) = node {
      self
        .non_static_access
        .entry(id!(ident))
        .or_default()
        .push(ident.span);
    }

    node.visit_children_with(self);
  }

  fn visit_for_in_stmt(&mut self, node: &ForInStmt) {
    self.add_reassigned_namespaces(&node.left);
    node.visit_children_with(self);
  }

  fn visit_for_of_stmt(&mut self, node: &ForOfStmt) {
    self.add_reassigned_namespaces(&node.left);
    node.visit_children_with(self);
  }

  fn visit_call_expr(&mut self, node: &CallExpr) {
    if let Callee::Expr(expr) = &node.callee {
      match &**expr {
        Expr::Ident(ident) => {
          if ident.sym == "eval" && is_unresolved(&ident, self.unresolved_mark) {
            self.should_wrap = true;
            self.add_bailout(node.span, BailoutReason::Eval);
          }
        }
        Expr::Member(member) => {
          // import('foo').then(foo => ...);
          if let Some(source) = match_import(&member.obj) {
            if match_property_name(member).map_or(false, |f| &*f.0 == "then") {
              if let Some(ExprOrSpread { expr, .. }) = node.args.first() {
                let param = match &**expr {
                  Expr::Fn(func) => func.function.params.first().map(|param| &param.pat),
                  Expr::Arrow(arrow) => arrow.params.first(),
                  _ => None,
                };

                if let Some(param) = param {
                  self.add_pat_imports(param, &source, ImportKind::DynamicImport);
                } else {
                  self.non_static_requires.insert(source.clone());
                  self.add_bailout(node.span, BailoutReason::NonStaticDynamicImport);
                }

                expr.visit_with(self);
                return;
              }
            }
          }
        }
        _ => {}
      }
    }

    node.visit_children_with(self);
  }
}

impl Collect {
  pub fn match_require(&self, node: &Expr) -> Option<JsWord> {
    match_require(node, self.unresolved_mark, self.ignore_mark)
  }

  fn add_pat_imports(&mut self, node: &Pat, src: &JsWord, kind: ImportKind) {
    if !self.in_top_level {
      if kind != ImportKind::DynamicImport {
        self.non_static_requires.insert(src.clone());
        let span = match node {
          Pat::Ident(id) => id.id.span,
          Pat::Array(arr) => arr.span,
          Pat::Object(obj) => obj.span,
          Pat::Rest(rest) => rest.span,
          Pat::Assign(assign) => assign.span,
          Pat::Invalid(i) => i.span,
          Pat::Expr(_) => DUMMY_SP,
        };
        self.add_bailout(span, BailoutReason::NonTopLevelRequire);
      }
    }

    match node {
      Pat::Ident(ident) => {
        // let x = require('y');
        // Need to track member accesses of `x`.
        self.imports.insert(
          id!(ident.id),
          Import {
            source: src.clone(),
            specifier: "*".into(),
            span: ident.id.span,
            kind,
          },
        );
      }
      Pat::Object(object) => {
        for prop in &object.props {
          match prop {
            ObjectPatProp::KeyValue(kv) => {
              let imported = match &kv.key {
                PropName::Ident(ident) => ident.sym.clone(),
                PropName::Str(str) => str.value.to_string_lossy().into(),
                _ => {
                  // Non-static. E.g. computed property.
                  self.non_static_requires.insert(src.clone());
                  self.add_bailout(object.span, BailoutReason::NonStaticDestructuring);
                  continue;
                }
              };

              match &*kv.value {
                Pat::Ident(ident) => {
                  // let {x: y} = require('y');
                  // Need to track `x` as a used symbol.
                  self.imports.insert(
                    id!(ident.id),
                    Import {
                      source: src.clone(),
                      specifier: imported,
                      span: ident.id.span,
                      kind,
                    },
                  );
                }
                _ => {
                  // Non-static.
                  self.non_static_requires.insert(src.clone());
                  self.add_bailout(object.span, BailoutReason::NonStaticDestructuring);
                }
              }
            }
            ObjectPatProp::Assign(assign) => {
              // let {x} = require('y');
              // let {x = 2} = require('y');
              // Need to track `x` as a used symbol.
              self.imports.insert(
                id!(assign.key),
                Import {
                  source: src.clone(),
                  specifier: assign.key.sym.clone(),
                  span: assign.key.span,
                  kind,
                },
              );
            }
            ObjectPatProp::Rest(_rest) => {
              // let {x, ...y} = require('y');
              // Non-static. We don't know what keys are used.
              self.non_static_requires.insert(src.clone());
              self.add_bailout(object.span, BailoutReason::NonStaticDestructuring);
            }
          }
        }
      }
      _ => {
        // Non-static.
        self.non_static_requires.insert(src.clone());
        let span = match node {
          Pat::Ident(id) => id.id.span,
          Pat::Array(arr) => arr.span,
          Pat::Object(obj) => obj.span,
          Pat::Rest(rest) => rest.span,
          Pat::Assign(assign) => assign.span,
          Pat::Invalid(i) => i.span,
          Pat::Expr(_) => DUMMY_SP,
        };
        self.add_bailout(span, BailoutReason::NonStaticDestructuring);
      }
    }
  }

  /// Marks bindings of an assignment target or declaration as accessed non-statically, so that a
  /// re-assigned namespace import keeps the whole namespace, e.g.
  /// `let ns = await import('foo'); ns = other;`. Afterwards, member accesses of the binding may
  /// not refer to the namespace.
  fn add_reassigned_namespaces<N: VisitWith<BindingIdentCollector>>(&mut self, node: &N) {
    let mut collector = BindingIdentCollector { idents: vec![] };
    node.visit_with(&mut collector);
    for (id, span) in collector.idents {
      self.non_static_access.entry(id).or_default().push(span);
    }
  }

  fn add_bailout(&mut self, span: Span, reason: BailoutReason) {
    if let Some(bailouts) = &mut self.bailouts {
      bailouts.push(Bailout { span: span, reason })
    }
  }
}

/// Collects the identifiers bound by a pattern or assignment target.
struct BindingIdentCollector {
  idents: Vec<(Id, Span)>,
}

impl Visit for BindingIdentCollector {
  noop_visit_type!();

  fn visit_binding_ident(&mut self, ident: &BindingIdent) {
    self.idents.push((id!(ident.id), ident.id.span));
  }
}

fn has_binding_identifier(node: &AssignTarget, sym: &JsWord, unresolved_mark: Mark) -> bool {
  pub struct BindingIdentFinder<'a> {
    sym: &'a JsWord,
    unresolved_mark: Mark,
    found: bool,
  }

  impl Visit for BindingIdentFinder<'_> {
    noop_visit_type!();

    fn visit_binding_ident(&mut self, ident: &BindingIdent) {
      if ident.id.sym == *self.sym && is_unresolved(&ident, self.unresolved_mark) {
        self.found = true;
      }
    }
  }

  let mut visitor = BindingIdentFinder {
    sym,
    unresolved_mark,
    found: false,
  };
  node.visit_with(&mut visitor);
  visitor.found
}

#[cfg(test)]
mod tests {
  use swc_core::{common::Mark, ecma::visit::VisitWith};

  use super::*;
  use crate::transformer::test_utils::run_with_transformation;

  /// The (source, symbol) pairs a module imports.
  fn imported_symbols(code: &str) -> Vec<(String, String)> {
    let (_, symbols) = run_with_transformation(code, |context, module| {
      let mut collect = Collect::new(
        context.unresolved_mark,
        Mark::fresh(Mark::root()),
        false,
        true,
      );
      module.visit_with(&mut collect);
      let sources: Vec<JsWord> = vec!["a".into(), "b".into()];
      collect.into_symbols(|source| sources.iter().position(|s| s == source).unwrap() as u32)
    });
    symbols
      .imports
      .iter()
      .map(|import| {
        (
          ["a", "b"][import.dep_index as usize].to_string(),
          import.symbol.as_str().to_string(),
        )
      })
      .collect()
  }

  fn pairs(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs
      .iter()
      .map(|(source, symbol)| (source.to_string(), symbol.to_string()))
      .collect()
  }

  #[test]
  fn namespace_static_access() {
    assert_eq!(
      imported_symbols("import * as ns from 'a'; ns.foo(); ns['bar']; ns.foo.baz;"),
      pairs(&[("a", "foo"), ("a", "bar")])
    );
  }

  #[test]
  fn namespace_non_static_access() {
    for code in [
      "import * as ns from 'a'; ns.foo; ns[key];",
      "import * as ns from 'a'; ns.foo; use(ns);",
      "import * as ns from 'a'; ns.foo; let o = {ns};",
      "import * as ns from 'a'; ns.foo; export default ns;",
    ] {
      assert_eq!(imported_symbols(code), pairs(&[("a", "*")]), "{code}");
    }
  }

  #[test]
  fn dynamic_import_static_access() {
    assert_eq!(
      imported_symbols("import('a').then(ns => ns.foo); const b = await import('b'); b.bar;"),
      pairs(&[("a", "foo"), ("b", "bar")])
    );
  }

  #[test]
  fn dynamic_import_non_static_access() {
    for code in [
      "import('a').then(ns => ns[key]);",
      "import('a').then(ns => ns);",
      "let ns = await import('a'); ns.foo; ns = other;",
      "(await import('a')).foo;",
    ] {
      assert_eq!(imported_symbols(code), pairs(&[("a", "*")]), "{code}");
    }
  }

  #[test]
  fn access_before_declaration() {
    assert_eq!(
      imported_symbols("function f() { return ns.foo; } sideEffect(f()); import * as ns from 'a';"),
      pairs(&[("a", "foo")])
    );
    assert_eq!(
      imported_symbols(
        "async function f() { function g() { return ns.foo + bar; } const ns = await import('a'); const {bar} = await import('b'); return g() + ns.baz; }"
      ),
      pairs(&[("a", "foo"), ("b", "bar"), ("a", "baz")])
    );
    assert_eq!(
      imported_symbols(
        "async function f() { function g() { return ns[key]; } const ns = await import('a'); return g(); }"
      ),
      pairs(&[("a", "*")])
    );
  }

  #[test]
  fn require_static_access() {
    // CommonJS requires keep the whole namespace.
    assert_eq!(
      imported_symbols("const ns = require('a'); ns.foo;"),
      pairs(&[("a", "*")])
    );
  }
}
