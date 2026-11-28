use std::collections::{HashMap, HashSet};

use parcel_core::{
  AssetFlags, AssetSymbols, ImportedSymbol, IndirectSymbol, LocalReference, LocalSymbol,
  StarSymbol, SymbolName, SymbolResolution,
};

use swc_core::{
  common::{DUMMY_SP, Mark, Span, SyntaxContext},
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

/// How a CommonJS module or dynamic import is loaded.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum ImportKind {
  Require,
  DynamicImport,
}

#[derive(Debug)]
pub struct Import {
  pub source: JsWord,
  pub specifier: JsWord,
  pub span: Span,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Export {
  pub source: Option<JsWord>,
  pub specifier: JsWord,
  pub span: Span,
  pub is_esm: bool,
}

/// A static import or top-level function, whose references `Collect::owned` records.
#[derive(Debug)]
struct Owned {
  /// The function's number, if it is a top-level function (see `Collect::functions`).
  function: Option<u32>,
  references: References,
}

/// Where an import or top-level function is referenced.
#[derive(Debug)]
enum References {
  /// Only in the body of these top-level functions, by index into `Collect::functions`. Empty if
  /// it isn't referenced.
  Functions(Vec<u32>),
  /// Outside of top-level functions, e.g. at the top level or in a class.
  Elsewhere,
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
  /// (source, property) of static accesses of requires that aren't bound to a variable, e.g.
  /// `require('foo').bar`
  pub static_require_access: Vec<(JsWord, JsWord, Span)>,
  pub non_static_requires: HashSet<JsWord>,
  /// Exports the module reads from its own exports object (e.g. `exports.foo`), with the export
  /// whose function the read is in, if the read only happens when that export is used.
  pub self_references: Vec<(JsWord, Option<JsWord>)>,
  /// Whether to find the exports whose functions are the only code using each import (see
  /// `ImportedSymbol::owners`), which tree shaking removes when the exports aren't requested.
  pub find_import_owners: bool,
  pub bailouts: Option<Vec<Bailout>>,
  /// The static imports and top-level functions, and where each is referenced (see
  /// `find_import_owners`).
  owned: HashMap<Id, Owned>,
  /// The top-level functions in `owned`, in the order they are numbered by `References`.
  functions: Vec<Id>,
  /// The top-level function being visited (see `owned`).
  function: Option<u32>,
  /// The export whose function is being visited (see `self_references`).
  export_owner: Option<JsWord>,
  /// Whether the next member expression visited is the target of an assignment, which assigns
  /// rather than reads it.
  in_assign_target: bool,
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
      static_require_access: Vec::new(),
      non_static_requires: HashSet::new(),
      self_references: Vec::new(),
      find_import_owners: false,
      owned: HashMap::new(),
      functions: Vec::new(),
      function: None,
      export_owner: None,
      in_assign_target: false,
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
    // Exports are only removed from static ES modules.
    let find_import_owners =
      self.find_import_owners && self.is_esm && !self.has_cjs_exports && self.is_static();
    let Collect {
      imports,
      used_imports,
      exports,
      exports_all,
      non_static_access,
      static_access,
      static_require_access,
      non_static_requires,
      self_references,
      owned,
      functions,
      has_cjs_exports,
      ..
    } = self;
    let mut symbols = AssetSymbols::default();

    // A namespace import, require or dynamic import that is only accessed statically (e.g.
    // `ns.foo`) imports just the accessed properties. Any other usage, e.g. a computed access,
    // passing the namespace around or re-assigning the binding, observes the whole namespace.
    // Each with the binding it is imported as, if any.
    let mut imported: Vec<(Span, &JsWord, &JsWord, &JsWord, Option<&Id>)> = Vec::new();
    for (local, import) in &imports {
      if !used_imports.contains(local) {
        continue;
      }

      if import.specifier == "*"
        && !non_static_access.contains_key(local)
        && let Some(accesses) = static_access.get(local)
      {
        let mut seen = HashSet::new();
        for (name, span) in accesses {
          if seen.insert(name) {
            imported.push((*span, name, &import.source, name, Some(local)));
          }
        }
      } else {
        imported.push((
          import.span,
          &local.0,
          &import.source,
          &import.specifier,
          Some(local),
        ));
      }
    }

    let mut seen = HashSet::new();
    for (source, name, span) in &static_require_access {
      if seen.insert((source, name)) {
        imported.push((*span, name, source, name, None));
      }
    }

    // The collect maps are HashMaps, so sort by source location to keep symbol
    // order deterministic across builds (it flows into asset symbols and output).
    imported.sort_by(|(a_span, a_name, ..), (b_span, b_name, ..)| {
      (a_span.lo, a_name).cmp(&(b_span.lo, b_name))
    });
    let mut import_locals = Vec::new();
    symbols.imports = imported
      .into_iter()
      .map(|(_, _, source, symbol, local)| {
        import_locals.push(local);
        ImportedSymbol {
          dep_index: dep_index(source),
          symbol: SymbolName::from(symbol.as_str()),
          resolved: SymbolResolution::None,
          owners: Vec::new(),
        }
      })
      .collect();

    let mut exports: Vec<_> = exports.into_iter().collect();
    exports.sort_by(|(a_exported, a), (b_exported, b)| {
      (a.span.lo, a_exported).cmp(&(b.span.lo, b_exported))
    });
    // The index of each of the module's own exports, by name.
    let mut export_indices: HashMap<JsWord, u32> = HashMap::new();
    // The exports each top-level function is exported as.
    let function_indices: HashMap<&JsWord, usize> = functions
      .iter()
      .enumerate()
      .map(|(index, id)| (&id.0, index))
      .collect();
    let mut function_exports: Vec<Vec<u32>> = vec![Vec::new(); functions.len()];
    for (exported_name, export) in exports {
      let exported = SymbolName::from(exported_name.as_str());
      if export.source.is_none() {
        let index = symbols.exports.len() as u32;
        if let Some(&function) = function_indices.get(&export.specifier) {
          function_exports[function].push(index);
        }
        export_indices.insert(exported_name, index);
      }
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
          self_referenced: false,
        }),
      }
    }

    let mut local_references = Vec::new();
    for (name, owner) in &self_references {
      let Some(&to) = export_indices.get(name) else {
        continue;
      };
      match owner.as_ref().and_then(|owner| export_indices.get(owner)) {
        Some(&from) if from != to => local_references.push(LocalReference { from, to }),
        Some(_) => {}
        None => symbols.exports[to as usize].self_referenced = true,
      }
    }

    // Tree shaking removes the functions of unrequested exports, and then the minifier removes the
    // functions only those referenced, so an import only such functions use is only needed if one
    // of their exports is. One only unreferenced functions use isn't needed at all.
    if find_import_owners {
      let owners = function_owners(&owned, &functions, function_exports);
      let mut needed = Vec::with_capacity(symbols.imports.len());
      for (import, local) in symbols.imports.iter_mut().zip(import_locals) {
        let using = match local.and_then(|local| owned.get(local)) {
          Some(Owned {
            references: References::Functions(using),
            ..
          }) if !using.is_empty() => using,
          _ => {
            needed.push(true);
            continue;
          }
        };
        let mut import_owners = Vec::new();
        let owned_by_functions = using
          .iter()
          .all(|&function| match &owners[function as usize] {
            Some(owners) => {
              import_owners.extend_from_slice(owners);
              true
            }
            None => false,
          });
        if owned_by_functions {
          import_owners.sort_unstable();
          import_owners.dedup();
          needed.push(!import_owners.is_empty());
          import.owners = import_owners;
        } else {
          needed.push(true);
        }
      }
      let mut needed = needed.into_iter();
      symbols.imports.retain(|_| needed.next().unwrap());
    }

    local_references.sort_by_key(|reference| (reference.from, reference.to));
    local_references.dedup();
    symbols.local_references = local_references;

    // Add * symbol if there are any CJS exports so that unknown symbols don't cause errors (e.g. default interop).
    if has_cjs_exports {
      symbols.exports.push(LocalSymbol {
        exported: SymbolName::Namespace,
        requested: false,
        self_referenced: false,
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
      owners: Vec::new(),
    });
  }
}

impl Visit for Collect {
  fn visit_module(&mut self, node: &Module) {
    self.in_module_this = true;
    self.in_top_level = true;
    self.in_function = false;
    if self.find_import_owners {
      self.find_owned(node);
    }
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

          self.visit_declarator(decl, |this| decl.init.visit_with(this));
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

    match &node.decl {
      DefaultDecl::Fn(function) => self
        .visit_function_body(&default_function_id(function), |this| {
          node.visit_children_with(this)
        }),
      _ => node.visit_children_with(self),
    }
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

    let is_assign_target = std::mem::take(&mut self.in_assign_target);
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
          if !is_assign_target {
            self
              .self_references
              .push((name.clone(), self.export_owner.clone()));
          }
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
        self.add_reference(id!(ident));
        // Visit computed property keys so imported symbols used there are tracked.
        if let MemberProp::Computed(_) = &node.prop {
          node.prop.visit_with(self);
        }
        return;
      }
      Expr::Call(call) => {
        // `require('foo').bar` only imports `bar`.
        if let Some(source) = self.match_require(&node.obj)
          && let Some((name, _)) = match_property_name(node)
        {
          self.add_bailout(call.span, BailoutReason::NonTopLevelRequire);
          self.static_require_access.push((source, name, node.span));
          return;
        }
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
    // Any export of the required module could be observed.
    if let Some(source) = self.match_require(node) {
      self.non_static_requires.insert(source);
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

        self.add_reference(id!(ident));
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
    self.add_reference(id!(node));
  }

  fn visit_fn_decl(&mut self, node: &FnDecl) {
    self.visit_function_body(&id!(node.ident), |this| node.visit_children_with(this));
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

  fn visit_expr_stmt(&mut self, node: &ExprStmt) {
    // Tree shaking replaces the assignment of an unused export with its value, which doesn't call
    // a function. So reads in a function assigned to an export only happen when it is used.
    if let Expr::Assign(assign) = &*node.expr
      && assign.op == AssignOp::Assign
      && matches!(assign.right.unwrap_parens(), Expr::Fn(_) | Expr::Arrow(_))
      && let Some(name) = self.assigned_export(assign)
    {
      let export_owner = self.export_owner.replace(name);
      node.visit_children_with(self);
      self.export_owner = export_owner;
    } else {
      node.visit_children_with(self);
    }
  }

  fn visit_assign_expr(&mut self, node: &AssignExpr) {
    // if rhs is a require, record static accesses
    // if lhs is `exports`, mark as CJS exports re-assigned
    // if lhs is `module.exports`
    // if lhs is `module.exports.XXX` or `exports.XXX`, record static export

    // Assigning an export isn't a read of it, unless the assignment also reads it (e.g. `+=`).
    self.in_assign_target = node.op == AssignOp::Assign
      && matches!(
        &node.left,
        AssignTarget::Simple(SimpleAssignTarget::Member(_))
      );
    node.left.visit_with(self);
    self.in_assign_target = false;
    node.right.visit_with(self);
    self.add_assigned(&node.left);

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
    self.visit_declarator(node, |this| this.visit_var_declarator_children(node));
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
    self.add_assigned(&node.left);
    node.visit_children_with(self);
  }

  fn visit_for_of_stmt(&mut self, node: &ForOfStmt) {
    self.add_assigned(&node.left);
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

  fn visit_var_declarator_children(&mut self, node: &VarDeclarator) {
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

  /// The name of the export an assignment assigns, e.g. `foo` in `exports.foo = ...`.
  fn assigned_export(&self, node: &AssignExpr) -> Option<JsWord> {
    let AssignTarget::Simple(SimpleAssignTarget::Member(member)) = &node.left else {
      return None;
    };
    let is_exports = match &*member.obj {
      Expr::Ident(ident) => &*ident.sym == "exports" && is_unresolved(ident, self.unresolved_mark),
      Expr::Member(obj) => match_member_expr(obj, vec!["module", "exports"], self.unresolved_mark),
      Expr::This(_) => self.in_module_this && !self.is_module,
      _ => false,
    };
    if is_exports {
      match_property_name(member).map(|(name, _)| name)
    } else {
      None
    }
  }

  /// Records the module's static imports and numbers its top-level functions, whose references
  /// `add_reference` then records (see `find_import_owners`).
  fn find_owned(&mut self, module: &Module) {
    for item in &module.body {
      let decl = match item {
        ModuleItem::ModuleDecl(ModuleDecl::Import(import)) => {
          // Imports with attributes may not be JavaScript evaluated by the module, e.g. URLs.
          if !import.type_only && import.with.is_none() && import.phase == ImportPhase::Evaluation {
            for specifier in &import.specifiers {
              self.owned.insert(
                id!(specifier.local()),
                Owned {
                  function: None,
                  references: References::Functions(Vec::new()),
                },
              );
            }
          }
          continue;
        }
        ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(ExportDefaultDecl {
          decl: DefaultDecl::Fn(function),
          ..
        })) => {
          self.add_function(default_function_id(function));
          continue;
        }
        ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl { decl, .. }))
        | ModuleItem::Stmt(Stmt::Decl(decl)) => decl,
        _ => continue,
      };
      match decl {
        Decl::Fn(function) => self.add_function(id!(function.ident)),
        Decl::Var(var) => {
          for decl in &var.decls {
            if let Some(id) = function_binding(decl) {
              self.add_function(id);
            }
          }
        }
        _ => {}
      }
    }
  }

  fn add_function(&mut self, id: Id) {
    self.owned.insert(
      id.clone(),
      Owned {
        function: Some(self.functions.len() as u32),
        references: References::Functions(Vec::new()),
      },
    );
    self.functions.push(id);
  }

  /// Records a reference to a binding: the binding is used, and if it is in `owned`, where.
  fn add_reference(&mut self, id: Id) {
    if let Some(owned) = self.owned.get_mut(&id) {
      match (&mut owned.references, self.function) {
        (References::Functions(functions), Some(function)) => {
          if !functions.contains(&function) {
            functions.push(function);
          }
        }
        (references, None) => *references = References::Elsewhere,
        (References::Elsewhere, Some(_)) => {}
      }
    }
    self.used_imports.insert(id);
  }

  /// Visits the body of the top-level function `id` binds, if it does, attributing references in
  /// it to the function.
  fn visit_function_body(&mut self, id: &Id, visit: impl FnOnce(&mut Self)) {
    let function = self.owned.get(id).and_then(|owned| owned.function);
    if function.is_some() && self.function.is_none() {
      self.function = function;
      visit(self);
      self.function = None;
    } else {
      visit(self);
    }
  }

  /// Visits a variable declarator, in the body of the top-level function it declares, if any.
  fn visit_declarator(&mut self, decl: &VarDeclarator, visit: impl FnOnce(&mut Self)) {
    match function_binding(decl) {
      Some(id) => self.visit_function_body(&id, visit),
      None => visit(self),
    }
  }

  /// Marks the bindings an assignment target assigns as re-assigned (see
  /// `add_reassigned_namespaces`). Assigning a function is also a reference to it, e.g. `f = g`.
  fn add_assigned<N: VisitWith<BindingIdentCollector>>(&mut self, node: &N) {
    let mut collector = BindingIdentCollector { idents: vec![] };
    node.visit_with(&mut collector);
    for (id, span) in collector.idents {
      if let Some(owned) = self.owned.get_mut(&id) {
        owned.references = References::Elsewhere;
      }
      self.non_static_access.entry(id).or_default().push(span);
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

/// The exports that keep each top-level function: its own, and those of the functions that
/// reference it, transitively. None if something else references it, so it is always kept.
fn function_owners(
  owned: &HashMap<Id, Owned>,
  functions: &[Id],
  function_exports: Vec<Vec<u32>>,
) -> Vec<Option<Vec<u32>>> {
  // The other functions each function references.
  let mut referenced: Vec<Vec<u32>> = vec![Vec::new(); functions.len()];
  let mut owners: Vec<Option<Vec<u32>>> = function_exports.into_iter().map(Some).collect();
  for (function, id) in functions.iter().enumerate() {
    match &owned[id].references {
      References::Functions(referencing) => {
        for &by in referencing {
          if by as usize != function {
            referenced[by as usize].push(function as u32);
          }
        }
      }
      References::Elsewhere => owners[function] = None,
    }
  }

  let mut queue: Vec<u32> = (0..functions.len() as u32).collect();
  while let Some(by) = queue.pop() {
    let by_owners = owners[by as usize].clone();
    for &function in &referenced[by as usize] {
      let changed = match (&by_owners, &mut owners[function as usize]) {
        (_, None) => false,
        (None, function_owners) => {
          *function_owners = None;
          true
        }
        (Some(by_owners), Some(function_owners)) => {
          let len = function_owners.len();
          function_owners.extend_from_slice(by_owners);
          function_owners.sort_unstable();
          function_owners.dedup();
          function_owners.len() != len
        }
      };
      if changed {
        queue.push(function);
      }
    }
  }
  owners
}

/// The binding a variable declarator gives a function, which tree shaking removes with the
/// binding, e.g. `const f = () => {}`. Nothing in the function runs until it is called.
fn function_binding(decl: &VarDeclarator) -> Option<Id> {
  match (&decl.name, decl.init.as_deref().map(Expr::unwrap_parens)) {
    (Pat::Ident(name), Some(Expr::Fn(_) | Expr::Arrow(_))) => Some(id!(name.id)),
    _ => None,
  }
}

/// The binding of an exported default function, or for `export default function () {}`, which
/// has none, a name no binding can have, which is the local name `Collect::exports` gives it.
fn default_function_id(function: &FnExpr) -> Id {
  function.ident.as_ref().map_or_else(
    || ("default".into(), SyntaxContext::empty()),
    |ident| id!(ident),
  )
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
  fn inline_require() {
    assert_eq!(
      imported_symbols("sideEffect(require('a').foo, require('a')['bar'], require('a').foo);"),
      pairs(&[("a", "foo"), ("a", "bar")])
    );
    assert_eq!(
      imported_symbols("sideEffect(require('a'), require('b')[key]);"),
      pairs(&[("a", "*"), ("b", "*")])
    );
    assert_eq!(
      imported_symbols("function f() { return require('a').foo; }"),
      pairs(&[("a", "foo")])
    );
  }

  #[test]
  fn require_static_access() {
    assert_eq!(
      imported_symbols("const ns = require('a'); ns.foo(); ns['bar']; ns.foo.baz;"),
      pairs(&[("a", "foo"), ("a", "bar")])
    );
    assert_eq!(
      imported_symbols("const {foo, bar: baz} = require('a'); foo(baz);"),
      pairs(&[("a", "foo"), ("a", "bar")])
    );
  }

  /// The (message, documentation URL) of each bailout diagnostic for a script.
  fn bailout_diagnostics(code: &str) -> Vec<(String, String)> {
    let (_, diagnostics) = run_with_transformation(code, |context, module| {
      let mut collect = Collect::new(
        context.unresolved_mark,
        Mark::fresh(Mark::root()),
        true,
        false,
      );
      module.visit_with(&mut collect);
      collect
        .bailouts
        .unwrap()
        .iter()
        .map(|bailout| {
          let diagnostic = bailout.to_diagnostic(&context.source_map);
          (diagnostic.message, diagnostic.documentation_url.unwrap())
        })
        .collect::<Vec<_>>()
    });
    diagnostics
  }

  #[test]
  fn bailout_diagnostics_link_tree_shaking_docs() {
    assert_eq!(
      bailout_diagnostics("if (x) { require('a'); } eval('y'); exports = {};"),
      vec![
        (
          "Conditional or non-top-level `require()` call. This causes all exports of the resolved module to be included.".into(),
          "https://parceljs.org/features/tree-shaking/#avoid-conditional-require()".into()
        ),
        (
          "Module contains usage of `eval`. This disables tree shaking for the module and its dependencies, and prevents the minifier from renaming variables.".into(),
          "https://parceljs.org/features/tree-shaking/#avoid-eval".into()
        ),
        (
          "Module contains a reassignment of the CommonJS `exports` object. This disables tree shaking for the module and its dependencies.".into(),
          "https://parceljs.org/features/tree-shaking/#avoid-module-and-exports-re-assignment".into()
        ),
      ]
    );
  }

  #[test]
  fn require_non_static_access() {
    for code in [
      "const ns = require('a'); ns.foo; ns[key];",
      "const ns = require('a'); ns.foo; use(ns);",
      "const ns = require('a'); ns.foo; let o = {ns};",
      "const ns = require('a'); ns.foo; module.exports = ns;",
      "let ns = require('a'); ns.foo; ns = other;",
      "const {foo, ...rest} = require('a');",
      "function f() { const ns = require('a'); return ns.foo; }",
      "if (cond) { const ns = require('a'); ns.foo; }",
    ] {
      assert!(
        imported_symbols(code).contains(&("a".to_string(), "*".to_string())),
        "{code}"
      );
    }
  }

  /// The exports each owned import is owned by, by imported name.
  fn import_owners(code: &str) -> Vec<(String, Vec<String>)> {
    let (_, symbols) = run_with_transformation(code, |context, module| {
      let mut collect = Collect::new(
        context.unresolved_mark,
        Mark::fresh(Mark::root()),
        false,
        true,
      );
      collect.find_import_owners = true;
      module.visit_with(&mut collect);
      collect.into_symbols(|_| 0)
    });
    let mut owners: Vec<_> = symbols
      .imports
      .iter()
      .filter(|import| !import.owners.is_empty())
      .map(|import| {
        let mut names: Vec<String> = import
          .owners
          .iter()
          .map(|&owner| {
            symbols.exports[owner as usize]
              .exported
              .as_str()
              .to_string()
          })
          .collect();
        names.sort();
        (import.symbol.as_str().to_string(), names)
      })
      .collect();
    owners.sort();
    owners
  }

  fn expected_owners(owners: &[(&str, &[&str])]) -> Vec<(String, Vec<String>)> {
    owners
      .iter()
      .map(|(symbol, names)| {
        (
          symbol.to_string(),
          names.iter().map(|name| name.to_string()).collect(),
        )
      })
      .collect()
  }

  #[test]
  fn imports_used_by_exported_functions() {
    assert_eq!(
      import_owners(
        "import {a, b} from 'x'; import c from 'y'; import * as ns from 'z';
        export function f() { return a() + ns.foo; }
        export const g = () => b;
        export const h = function () { return a(c); };
        export default function () { return c; }"
      ),
      expected_owners(&[
        ("a", &["f", "h"]),
        ("b", &["g"]),
        ("default", &["default", "h"]),
        ("foo", &["f"]),
      ])
    );
  }

  #[test]
  fn imports_used_by_functions_in_export_lists() {
    assert_eq!(
      import_owners(
        "import {a} from 'x';
        function f() { return a; }
        const g = () => a;
        export {f, f as h, g as default};"
      ),
      expected_owners(&[("a", &["default", "f", "h"])])
    );
  }

  #[test]
  fn imports_declared_after_the_functions_using_them() {
    assert_eq!(
      import_owners(
        "export function f() { return a; } export function g() { return a; } import {a} from 'x';"
      ),
      expected_owners(&[("a", &["f", "g"])])
    );
  }

  #[test]
  fn functions_calling_themselves() {
    assert_eq!(
      import_owners("import {a} from 'x'; export function f(n) { return n ? f(n - 1) : a; }"),
      expected_owners(&[("a", &["f"])])
    );
  }

  #[test]
  fn imports_used_otherwise() {
    for code in [
      // Used at the top level, or by something other than a function.
      "import {a} from 'x'; export function f() { return a; } console.log(a);",
      "import {a} from 'x'; export const f = a;",
      "import {a} from 'x'; export class C { m() { return a; } }",
      // The function is referenced elsewhere, so it isn't removed with its export.
      "import {a} from 'x'; export function f() { return a; } f.displayName = 'f';",
      "import {a} from 'x'; export let f = () => a; f = null;",
      "import {a} from 'x'; export let f = () => a; [f] = [null];",
      "import {a} from 'x'; function f() { return a; } export default f;",
      "import {a} from 'x'; export function f() { return a; } setTimeout(f);",
      // So are the functions it references.
      "import {a} from 'x'; function f() { return a; } export function g() { return f(); } g();",
      "import {a} from 'x'; function f() { return a; } export class C { m() { return f(); } }",
      // Not JavaScript evaluated by the module.
      "import a from 'x' with {type: 'url'}; export function f() { return a; }",
      // References can't be found statically.
      "import {a} from 'x'; export function f() { return a; } eval('f()');",
    ] {
      assert_eq!(import_owners(code), expected_owners(&[]), "{code}");
    }
  }

  #[test]
  fn imports_used_by_functions_exported_functions_use() {
    assert_eq!(
      import_owners(
        "import {a, b} from 'x';
        function f() { return a; }
        function g() { return f() + b; }
        export function h() { return g(); }
        export const i = () => f();
        export function j() { return a; }"
      ),
      expected_owners(&[("a", &["h", "i", "j"]), ("b", &["h"])])
    );
  }

  /// The names a module imports.
  fn imported_names(code: &str) -> Vec<String> {
    let (_, symbols) = run_with_transformation(code, |context, module| {
      let mut collect = Collect::new(
        context.unresolved_mark,
        Mark::fresh(Mark::root()),
        false,
        true,
      );
      collect.find_import_owners = true;
      module.visit_with(&mut collect);
      collect.into_symbols(|_| 0)
    });
    symbols
      .imports
      .iter()
      .map(|import| import.symbol.as_str().to_string())
      .collect()
  }

  #[test]
  fn imports_only_unreferenced_functions_use_are_not_imported() {
    for code in [
      "import {a} from 'x'; function f() { return a; } export const b = 1;",
      "import {a} from 'x'; const f = () => a; function g() { return f(); } export const b = 1;",
      "import {a} from 'x'; function f() { return a && g(); } function g() { return f(); }
      export const b = 1;",
    ] {
      assert_eq!(imported_names(code), Vec::<String>::new(), "{code}");
    }
    // Unless finding import owners, e.g. when not minifying.
    let (_, symbols) = run_with_transformation(
      "import {a} from 'x'; function f() { return a; } export const b = 1;",
      |context, module| {
        let mut collect = Collect::new(
          context.unresolved_mark,
          Mark::fresh(Mark::root()),
          false,
          true,
        );
        module.visit_with(&mut collect);
        collect.into_symbols(|_| 0)
      },
    );
    assert_eq!(symbols.imports.len(), 1);
  }

  #[test]
  fn unused_imports_are_not_imported() {
    let code = "import {a} from 'x'; export const b = 1;";
    assert_eq!(imported_names(code), Vec::<String>::new());
    let (_, symbols) = run_with_transformation(code, |context, module| {
      let mut collect = Collect::new(
        context.unresolved_mark,
        Mark::fresh(Mark::root()),
        false,
        true,
      );
      module.visit_with(&mut collect);
      collect.into_symbols(|_| 0)
    });
    assert!(symbols.imports.is_empty());
  }

  #[test]
  fn shadowed_bindings_are_not_references() {
    assert_eq!(
      import_owners(
        "import {a} from 'x'; export function f() { return a; }
        function g() { const a = 1; return a; } g();"
      ),
      expected_owners(&[("a", &["f"])])
    );
  }

  /// The exports a CommonJS script references itself, and the references between its exports.
  fn self_references(code: &str) -> (Vec<String>, Vec<(String, String)>) {
    let (_, symbols) = run_with_transformation(code, |context, module| {
      let mut collect = Collect::new(
        context.unresolved_mark,
        Mark::fresh(Mark::root()),
        false,
        false,
      );
      module.visit_with(&mut collect);
      collect.into_symbols(|_| 0)
    });
    let name = |index: u32| {
      symbols.exports[index as usize]
        .exported
        .as_str()
        .to_string()
    };
    let mut self_referenced: Vec<String> = symbols
      .exports
      .iter()
      .filter(|export| export.self_referenced)
      .map(|export| export.exported.as_str().to_string())
      .collect();
    self_referenced.sort();
    let references = symbols
      .local_references
      .iter()
      .map(|reference| (name(reference.from), name(reference.to)))
      .collect();
    (self_referenced, references)
  }

  #[test]
  fn self_references_in_exported_functions() {
    for code in [
      "exports.a = 1; exports.b = function () { return exports.a; };",
      "exports.a = 1; module.exports.b = () => module.exports.a;",
      "this.a = 1; this.b = () => this.a;",
      "exports.a = 1; exports.b = (function () { return function () { return exports.a; }; });",
    ] {
      assert_eq!(
        self_references(code),
        (vec![], vec![("b".into(), "a".into())]),
        "{code}"
      );
    }
  }

  #[test]
  fn self_references_outside_exported_functions() {
    for code in [
      // Read when the module runs.
      "exports.a = 1; console.log(exports.a);",
      "exports.a = 1; exports.b = exports.a + 1;",
      "exports.a = 1; exports.a += 1;",
      // Called when the module runs, even if `b` isn't used.
      "exports.a = 1; exports.b = (function () { return exports.a; })();",
      "exports.a = 1; exports.b = wrap(() => exports.a);",
      // The function is also the value of `c`, or used by `f`.
      "exports.a = 1; exports.b = exports.c = function () { return exports.a; };",
      "exports.a = 1; function f() { return exports.a; } exports.b = f;",
      // Not a statement that tree shaking removes.
      "exports.a = 1; use(exports.b = function () { return exports.a; });",
    ] {
      let (self_referenced, references) = self_references(code);
      assert!(self_referenced.contains(&"a".to_string()), "{code}");
      assert!(
        !references.iter().any(|(_, to)| to == "a"),
        "{code}: {references:?}"
      );
    }
  }

  #[test]
  fn assigning_an_export_is_not_a_self_reference() {
    assert_eq!(
      self_references(
        "exports.a = 1; module.exports.b = 2; this.c = 3; exports.d = exports.e = 4;"
      ),
      (vec![], vec![])
    );
  }

  #[test]
  fn this_in_a_function_is_not_a_self_reference() {
    assert_eq!(
      self_references("this.a = 1; exports.b = function () { return this.a; };"),
      (vec![], vec![])
    );
  }
}
