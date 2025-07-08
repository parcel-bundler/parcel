use std::{
  cell::RefCell,
  collections::{HashMap, HashSet},
  rc::Rc,
  sync::Arc,
};

use indexmap::IndexMap;
use parcel_core::{
  BundleBehavior, Dependency, DependencyFlags, Diagnostic, Environment, Location, Priority,
  SourceLocation, SpecifierType,
};
use swc_core::{
  common::{sync::Lrc, util::take::Take, FileName, SourceMap, Span, Spanned, DUMMY_SP},
  ecma::{
    ast::{Module as SwcModule, ModuleDecl, ModuleItem, *},
    atoms::Atom as JsWord,
    utils::{for_each_binding_ident, private_ident},
  },
  quote,
};

use crate::{macros::MacroModule, path::create_path_module, Evaluate, Evaluator, JsValue, Object};

pub struct ModuleRecord {
  pub env: Arc<Environment>,
  pub source_map: Lrc<SourceMap>,
  pub dependencies: Vec<Dependency>,
  import_entries: Vec<ImportEntry>,
  local_exports: IndexMap<Symbol, LocalExportRecord>,
  indirect_exports: IndexMap<Symbol, IndirectExportRecord>,
  star_exports: Vec<JsWord>,
  import_namespaces: Vec<JsValue>,
  pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct DepSymbol {
  dep: usize,
  symbol: Symbol,
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum Symbol {
  Namespace,
  AllButDefault,
  Default,
  Name(JsWord),
}

impl From<JsWord> for Symbol {
  fn from(value: JsWord) -> Self {
    match value.as_str() {
      "default" => Symbol::Default,
      _ => Symbol::Name(value),
    }
  }
}

impl TryFrom<Symbol> for JsWord {
  type Error = ();

  fn try_from(value: Symbol) -> Result<Self, Self::Error> {
    match value {
      Symbol::Default => Ok("default".into()),
      Symbol::Name(name) => Ok(name),
      _ => Err(()),
    }
  }
}

struct ImportEntry {
  dependency_index: u32,
  import_name: Symbol,
  local: Id,
  span: Span,
}

struct LocalExportRecord {
  local: Id,
  span: Span,
}

struct IndirectExportRecord {
  dependency_index: u32,
  import_name: Symbol,
  span: Span,
}

impl ModuleRecord {
  pub fn new(env: Arc<Environment>, source_map: Lrc<SourceMap>) -> Self {
    ModuleRecord {
      env,
      source_map,
      dependencies: Vec::new(),
      import_entries: Vec::new(),
      local_exports: IndexMap::new(),
      indirect_exports: IndexMap::new(),
      star_exports: Vec::new(),
      import_namespaces: Vec::new(),
      diagnostics: Vec::new(),
    }
  }

  pub fn add_dependency(&mut self, dep: Dependency) -> u32 {
    let index = self.dependencies.len();
    self.dependencies.push(dep);
    self.import_namespaces.push(JsValue::Undefined);
    index as u32
  }

  pub fn add_import_dependency(&mut self, src: JsWord) -> u32 {
    let dep = Dependency {
      specifier: src.to_string(),
      specifier_type: SpecifierType::Esm,
      priority: Priority::Sync,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::IS_ESM,
      env: self.env.clone(),
      loc: None,
      placeholder: None,
      range: None,
      resolve_from: None,
    };
    self.add_dependency(dep)
  }

  pub fn get_import_namespace(&mut self, index: u32) -> JsValue {
    if matches!(self.import_namespaces[index as usize], JsValue::Object(_)) {
      return self.import_namespaces[index as usize].clone();
    }

    let builtin = match self.dependencies[index as usize].specifier.as_str() {
      "path" | "node:path" => create_path_module(),
      // "fs" | "node:fs" => create_fs_module(self.project_root.to_string()),
      _ => JsValue::Unknown(DUMMY_SP),
    };

    let ns = JsValue::Object(
      Rc::new(ImportNamespace {
        index,
        symbols: RefCell::new(HashSet::new()),
        builtin,
      })
      .into(),
    );

    self.import_namespaces[index as usize] = ns.clone();
    ns
  }

  pub fn loc(&self, span: Span) -> SourceLocation {
    if span.lo.is_dummy() || span.hi.is_dummy() {
      return SourceLocation {
        file_path: "unknown".into(),
        start: Location { line: 1, column: 1 },
        end: Location { line: 1, column: 2 },
      };
    }

    let start = self.source_map.lookup_char_pos(span.lo);
    let end = self.source_map.lookup_char_pos(span.hi);
    // SWC's columns are exclusive, ours are exclusive
    // SWC has 0-based columns, ours are 1-based (column + 1)
    SourceLocation {
      file_path: match &*start.file.name {
        FileName::Real(p) => p.clone(),
        p => p.to_string().into(),
      },
      start: Location {
        line: start.line as u32,
        column: (start.col_display + 1) as u32,
      },
      end: Location {
        line: end.line as u32,
        column: (end.col_display + 1) as u32,
      },
    }
  }

  // https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-parsemodule
  pub fn parse_module(self: &mut ModuleRecord, module: &mut SwcModule, evaluator: &mut Evaluator) {
    let mut imported_bound_names = HashMap::new();
    let mut exports = Vec::<(Symbol, Id, Span)>::new();
    module.body.retain_mut(|item| {
      match item {
        ModuleItem::Stmt(_) => true,
        // import {foo} from 'foo';
        ModuleItem::ModuleDecl(ModuleDecl::Import(import)) => {
          let attrs = if let Some(attrs) = &import.with {
            attrs.evaluate(&evaluator)
          } else {
            JsValue::Unknown(import.span)
          };

          let dependency_index = self.add_import_dependency(import.src.value.clone());
          let namespace = if matches!(attrs.get(&JsValue::String("type".into()), DUMMY_SP), JsValue::String(t) if t == "macro")
          {
            // JsValue::Object(
            //   Rc::new(MacroModule {
            //     module: self.clone(),
            //     src: import.src.value.clone(),
            //     callback: self.call_macro.clone(),
            //   })
            //   .into(),
            // )
            todo!()
          } else {
            self.get_import_namespace(dependency_index)
          };

          for specifier in &import.specifiers {
            let index = self.import_entries.len();
            self.import_entries.push(ImportEntry {
              dependency_index,
              import_name: match &specifier {
                ImportSpecifier::Named(named) => Symbol::Name(
                  named
                    .imported
                    .as_ref()
                    .map(|i| i.atom().clone())
                    .unwrap_or_else(|| named.local.sym.clone()),
                ),
                ImportSpecifier::Default(_) => Symbol::Default,
                ImportSpecifier::Namespace(_) => Symbol::Namespace,
              },
              local: specifier.local().to_id(),
              span: specifier.span()
            });
            imported_bound_names.insert(specifier.local().to_id(), index);

            match specifier {
              ImportSpecifier::Named(named) => {
                let imported = match &named.imported {
                  Some(ModuleExportName::Ident(id)) => id.sym.clone(),
                  Some(ModuleExportName::Str(s)) => s.value.clone(),
                  None => named.local.sym.clone(),
                };
                let value = namespace.get(&JsValue::String(imported), named.span);
                evaluator.add_value(named.local.to_id(), value);
              }
              ImportSpecifier::Default(default) => {
                evaluator
                  .add_value(default.local.to_id(), namespace.clone());
              }
              ImportSpecifier::Namespace(ns) => {
                evaluator
                  .add_value(ns.local.to_id(), namespace.clone());
              }
            }
          }

          false
        }
        // export {foo};
        // export {foo} from 'foo';
        // export * as ns from 'foo';
        ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(export)) => {
          if let Some(src) = &export.src {
            for specifier in &export.specifiers {
              let export_name = match &specifier {
                ExportSpecifier::Named(named) => named
                  .exported
                  .as_ref()
                  .map(|i| i.atom().clone())
                  .unwrap_or_else(|| named.orig.atom().clone())
                  .into(),
                ExportSpecifier::Default(default) => default.exported.sym.clone().into(),
                ExportSpecifier::Namespace(namespace) => namespace.name.atom().clone().into(),
              };
              let dependency_index = self.add_import_dependency(src.value.clone());
              self.indirect_exports.insert(
                export_name,
                IndirectExportRecord {
                  dependency_index,
                  import_name: match specifier {
                    ExportSpecifier::Named(named) => named.orig.atom().clone().into(),
                    ExportSpecifier::Default(_) => Symbol::Default,
                    ExportSpecifier::Namespace(_) => Symbol::Namespace,
                  },
                  span: specifier.span()
                },
              );
            }
          } else {
            for specifier in &export.specifiers {
              let (exported, local) = match &specifier {
                ExportSpecifier::Named(named) => {
                  let exported = named
                    .exported
                    .as_ref()
                    .map(|i| i.atom().clone())
                    .unwrap_or_else(|| named.orig.atom().clone())
                    .into();
                  let local = match &named.orig {
                    ModuleExportName::Ident(id) => id.to_id(),
                    _ => unreachable!(),
                  };
                  (exported, local)
                }
                // ?? Are these even possible syntactically?
                ExportSpecifier::Default(_) => todo!(),
                ExportSpecifier::Namespace(_) => todo!(),
              };
              exports.push((exported, local, specifier.span()));
            }
          }

          false
        }
        // export default 2;
        ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultExpr(expr)) => {
          let id = private_ident!("_default");
          let stmt = Stmt::Decl(Decl::Var(Box::new(VarDecl {
            span: expr.span,
            ctxt: id.ctxt,
            declare: false,
            kind: VarDeclKind::Const,
            decls: vec![VarDeclarator {
              definite: false,
              init: Some(expr.expr.take()),
              name: Pat::Ident(BindingIdent {
                id: id.clone(),
                type_ann: None,
              }),
              span: expr.span,
            }],
          })));
          self
            .local_exports
            .insert(Symbol::Default, LocalExportRecord { local: id.to_id(), span: expr.span });

          *item = ModuleItem::Stmt(stmt);
          true
        }
        // export default function foo () {}
        // export default class Foo {}
        ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(decl)) => {
          let (stmt, id) = match &mut decl.decl {
            DefaultDecl::Fn(f) => {
              let id = f
                .ident
                .as_ref()
                .map(|id| id.clone())
                .unwrap_or_else(|| private_ident!("_default"));
              let stmt = Stmt::Decl(Decl::Fn(FnDecl {
                ident: id.clone(),
                declare: false,
                function: f.function.take(),
              }));
              (stmt, id.to_id())
            }
            DefaultDecl::Class(c) => {
              let id = c
                .ident
                .as_ref()
                .map(|id| id.clone())
                .unwrap_or_else(|| private_ident!("_default"));
              let stmt = Stmt::Decl(Decl::Class(ClassDecl {
                ident: id.clone(),
                declare: false,
                class: c.class.take(),
              }));
              (stmt, id.to_id())
            }
            DefaultDecl::TsInterfaceDecl(_) => return false,
          };
          self
            .local_exports
            .insert(Symbol::Default, LocalExportRecord { local: id, span: decl.span });

          *item = ModuleItem::Stmt(stmt);
          true
        }
        // export function foo() {}
        // export class Foo {}
        // export const foo = 2;
        ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(decl)) => match &mut decl.decl {
          Decl::Class(class) => {
            let export_name = class.ident.sym.clone().into();
            let local = class.ident.to_id();
            self
              .local_exports
              .insert(export_name, LocalExportRecord { local, span: decl.span });

            *item = ModuleItem::Stmt(Stmt::Decl(Decl::Class(class.take())));
            true
          }
          Decl::Fn(f) => {
            let export_name = f.ident.sym.clone().into();
            let local = f.ident.to_id();
            self
              .local_exports
              .insert(export_name, LocalExportRecord { local, span: decl.span });

            *item = ModuleItem::Stmt(Stmt::Decl(Decl::Fn(f.take())));
            true
          }
          Decl::Var(var) => {
            for decl in &var.decls {
              for_each_binding_ident(&decl.name, |ident| {
                self.local_exports.insert(
                  ident.sym.clone().into(),
                  LocalExportRecord {
                    local: ident.to_id(),
                    span: ident.span
                  },
                );
              });
            }

            *item = ModuleItem::Stmt(Stmt::Decl(Decl::Var(var.take())));
            true
          }
          Decl::Using(using) => {
            for decl in &using.decls {
              for_each_binding_ident(&decl.name, |ident| {
                self.local_exports.insert(
                  ident.sym.clone().into(),
                  LocalExportRecord {
                    local: ident.to_id(),
                    span: ident.span
                  },
                );
              });
            }

            *item = ModuleItem::Stmt(Stmt::Decl(Decl::Using(using.take())));
            true
          },
          Decl::TsInterface(_) | Decl::TsTypeAlias(_) | Decl::TsEnum(_) | Decl::TsModule(_) => {
            false
          }
        }
        // export * from 'foo';
        ModuleItem::ModuleDecl(ModuleDecl::ExportAll(decl)) => {
          self.star_exports.push(decl.src.value.clone());
          self.add_import_dependency(decl.src.value.clone());
          false
        }
        ModuleItem::ModuleDecl(ModuleDecl::TsImportEquals(_))
          | ModuleItem::ModuleDecl(ModuleDecl::TsNamespaceExport(_))
          | ModuleItem::ModuleDecl(ModuleDecl::TsExportAssignment(_)) => false,
      }
    });

    for (exported, local, span) in exports {
      if let Some(import_index) = imported_bound_names.get(&local) {
        let import_entry = &self.import_entries[*import_index];
        // This is a re-export.
        // TODO: the spec treats namespace re-exports as local names. Is that necessary?
        self.indirect_exports.insert(
          exported,
          IndirectExportRecord {
            dependency_index: import_entry.dependency_index,
            import_name: import_entry.import_name.clone(),
            span,
          },
        );
      } else {
        self
          .local_exports
          .insert(exported, LocalExportRecord { local, span });
      }
    }
  }
}

pub struct ImportNamespace {
  pub index: u32,
  pub symbols: RefCell<HashSet<Symbol>>,
  builtin: JsValue,
}

impl Object for ImportNamespace {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    if let JsValue::String(name) = prop {
      self.symbols.borrow_mut().insert(Symbol::Name(name.clone()));
    } else {
      self.symbols.borrow_mut().insert(Symbol::Namespace);
    }

    self.builtin.get(prop, span)
  }

  fn set(&self, _prop: JsValue, _value: JsValue) {
    // We need a namespace any time the import namespace is mutated.
    self.symbols.borrow_mut().insert(Symbol::Namespace);
  }

  fn has(&self, prop: &JsValue) -> bool {
    if let JsValue::Object(obj) = &self.builtin {
      obj.has(prop)
    } else {
      false
    }
  }

  fn entries<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
    self.symbols.borrow_mut().insert(Symbol::Namespace);

    if let JsValue::Object(obj) = &self.builtin {
      obj.entries()
    } else {
      Box::new(std::iter::empty())
    }
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    Ok(quote!("__parcel_dep__($index)" as Expr, index: Expr = (self.index as f64).into()))
  }
}
