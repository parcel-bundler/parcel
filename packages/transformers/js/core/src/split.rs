use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use swc_atoms::JsWord;
use swc_common::{SyntaxContext, DUMMY_SP};
use swc_ecmascript::{
  ast::{
    Decl, DefaultDecl, ExportDecl, ExportNamedSpecifier, ExportSpecifier, Id, Ident, ImportDecl,
    ImportNamedSpecifier, ImportSpecifier, ImportStarAsSpecifier, Module, ModuleDecl,
    ModuleExportName, ModuleItem, NamedExport, Stmt, VarDecl,
  },
  visit::{Visit, VisitWith},
};

use crate::{collect::Collect, utils::match_export_name_ident};

pub fn split(
  module_id: &str,
  module: Module,
  collect: &Collect,
) -> (Module, Vec<(String, Module)>) {
  let mut locals = vec![];
  let mut reexports = vec![];
  let mut exports: IndexMap<JsWord, Module> = IndexMap::new();

  let prefix_module_id = |v: usize| format!("{}{}", module_id, v);

  // a local binding -> (the module it's exported from, the export name)
  let mut exports_indices: HashMap<Id, (usize, JsWord)> = HashMap::new();
  let mut exports_index_default = None;
  let mut i = OFFSET;
  for it in &module.body {
    match it {
      ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(decl)) => {
        for n in get_decl_names(&decl.decl) {
          exports_indices.insert(n.clone(), (i, n.0));
          i += 1;
        }
      }
      ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(decl)) => {
        let ident = match &decl.decl {
          DefaultDecl::Class(v) => &v.ident,
          DefaultDecl::Fn(v) => &v.ident,
          _ => unreachable!(),
        }
        .as_ref()
        .unwrap();

        exports_indices.insert(ident.to_id(), (i, "default".into()));
        assert!(exports_index_default.is_none());
        exports_index_default = Some(i);
        i += 1;
      }
      ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultExpr(_)) => {
        assert!(exports_index_default.is_none());
        exports_index_default = Some(i);
        i += 1;
      }
      ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(NamedExport {
        specifiers,
        src: None,
        ..
      })) => {
        for spec in specifiers {
          let (local, exported) = match spec {
            ExportSpecifier::Namespace(_) => continue,
            ExportSpecifier::Default(v) => (&v.exported, "default".into()),
            ExportSpecifier::Named(spec) => (
              match_export_name_ident(&spec.orig),
              match spec.exported.as_ref().unwrap_or(&spec.orig) {
                ModuleExportName::Ident(v) => v.sym.clone(),
                ModuleExportName::Str(v) => v.value.clone(),
              },
            ),
          };
          exports_indices.insert(local.to_id(), (i, exported));
          i += 1;
        }
      }
      _ => {}
    }
  }

  for it in module.body {
    match it {
      ModuleItem::Stmt(stmt) => {
        let ids = if let Stmt::Decl(decl) = stmt {
          split_up_decl(decl)
        } else {
          locals.push(ModuleItem::Stmt(stmt));
          continue;
        };

        for (name, decl) in ids {
          if let Some((id, exported)) = exports_indices.get(&name) {
            reexports.push(ModuleItem::ModuleDecl(create_export_named(
              &(exported.clone(), SyntaxContext::empty()),
              None,
              Some(&prefix_module_id(*id)),
            )));

            let mut body =
              generate_imports(module_id, Some(&name), &decl, &exports_indices, collect);
            body.push(ModuleItem::Stmt(Stmt::Decl(decl)));
            body.push(ModuleItem::ModuleDecl(create_export_named(
              &name,
              Some(exported.clone()),
              None,
            )));
            exports.insert(
              exported.clone(),
              Module {
                body,
                span: DUMMY_SP,
                shebang: None,
              },
            );
          } else {
            locals.push(ModuleItem::Stmt(Stmt::Decl(decl)));
            locals.push(ModuleItem::ModuleDecl(create_export_named(
              &name, None, None,
            )));
          }
        }
      }
      ModuleItem::ModuleDecl(decl) => match decl {
        ModuleDecl::ExportDefaultDecl(decl) => {
          let idx = exports_index_default.unwrap();
          reexports.push(ModuleItem::ModuleDecl(create_export_named(
            &("default".into(), SyntaxContext::empty()),
            None,
            Some(&prefix_module_id(idx)),
          )));

          let name = match &decl.decl {
            DefaultDecl::Class(v) => v.ident.as_ref().map(|v| v.to_id()),
            DefaultDecl::Fn(v) => v.ident.as_ref().map(|v| v.to_id()),
            _ => unreachable!(),
          };

          let mut body = generate_imports(
            module_id,
            name.as_ref(),
            &decl.decl,
            &exports_indices,
            collect,
          );
          body.push(ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(decl)));
          exports.insert(
            "default".into(),
            Module {
              span: DUMMY_SP,
              body,
              shebang: None,
            },
          );
        }
        ModuleDecl::ExportDefaultExpr(expr) => {
          let idx = exports_index_default.unwrap();
          reexports.push(ModuleItem::ModuleDecl(create_export_named(
            &("default".into(), SyntaxContext::empty()),
            None,
            Some(&prefix_module_id(idx)),
          )));

          let mut body = generate_imports(module_id, None, &expr, &exports_indices, collect);
          body.push(ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultExpr(expr)));
          exports.insert(
            "default".into(),
            Module {
              span: DUMMY_SP,
              body,
              shebang: None,
            },
          );
        }
        ModuleDecl::ExportNamed(NamedExport { src: Some(_), .. }) | ModuleDecl::ExportAll(_) => {
          reexports.push(ModuleItem::ModuleDecl(decl));
        }
        ModuleDecl::ExportNamed(_) | ModuleDecl::Import(_) => continue,
        ModuleDecl::ExportDecl(decl) => {
          let exporteds = split_up_decl(decl.decl);

          for (exported, decl) in exporteds {
            let mut body =
              generate_imports(module_id, Some(&exported), &decl, &exports_indices, collect);
            body.push(ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
              span: DUMMY_SP,
              decl,
            })));
            exports.insert(
              exported.0.clone(),
              Module {
                span: DUMMY_SP,
                body,
                shebang: None,
              },
            );
            reexports.push(ModuleItem::ModuleDecl(create_export_named(
              &exported,
              None,
              Some(&prefix_module_id(exports_indices.get(&exported).unwrap().0)),
            )));
          }
        }
        _ => unreachable!(),
      },
    }
  }

  const OFFSET: usize = 2;
  let mut result = if !locals.is_empty() {
    vec![(
      format!("{}{}", module_id, 1),
      Module {
        body: locals,
        span: DUMMY_SP,
        shebang: None,
      },
    )]
  } else {
    vec![]
  };

  for (i, (_, module)) in exports.into_iter().enumerate() {
    result.push((format!("{}{}", module_id, OFFSET + i), module))
  }

  (
    Module {
      body: reexports,
      span: DUMMY_SP,
      shebang: None,
    },
    result,
  )
}

fn generate_imports<T: for<'a> VisitWith<Uses<'a>>>(
  module_id: &str,
  name: Option<&Id>,
  node: &T,
  exports_indices: &HashMap<Id, (usize, JsWord)>,
  collect: &Collect,
) -> Vec<ModuleItem> {
  let referenced_locals = find_referenced_locals(node, collect);

  referenced_locals
    .iter()
    .filter_map(|l| {
      if name.map_or(true, |name| l != name) {
        if let Some(imported) = collect.imports.get(l) {
          Some(ModuleItem::ModuleDecl(create_import(
            l,
            Some(imported.specifier.clone()),
            &imported.source,
          )))
        } else if let Some((i, imported)) = exports_indices.get(l) {
          Some(ModuleItem::ModuleDecl(create_import(
            l,
            Some(imported.clone()),
            &format!("{}{}", module_id, i),
          )))
        } else {
          Some(ModuleItem::ModuleDecl(create_import(
            l,
            None,
            &format!("{}{}", module_id, 1),
          )))
        }
      } else {
        None
      }
    })
    .collect()
}

fn create_import(local: &Id, imported: Option<JsWord>, src: &str) -> ModuleDecl {
  let local: Ident = Ident::from(local.clone());

  let is_namespace = imported.as_ref().map_or(false, |imported| imported == "*");
  ModuleDecl::Import(ImportDecl {
    span: DUMMY_SP,
    specifiers: vec![if is_namespace {
      ImportSpecifier::Namespace(ImportStarAsSpecifier {
        span: DUMMY_SP,
        local,
      })
    } else {
      ImportSpecifier::Named(ImportNamedSpecifier {
        span: DUMMY_SP,
        local,
        imported: imported.map(|imported| ModuleExportName::Ident(Ident::new(imported, DUMMY_SP))),
        is_type_only: false,
      })
    }],
    src: Box::new(src.into()),
    type_only: false,
    asserts: None,
  })
}

fn create_export_named(local: &Id, exported: Option<JsWord>, src: Option<&str>) -> ModuleDecl {
  ModuleDecl::ExportNamed(NamedExport {
    span: DUMMY_SP,
    specifiers: vec![ExportSpecifier::Named(ExportNamedSpecifier {
      span: DUMMY_SP,
      orig: ModuleExportName::Ident(Ident::from(local.clone())),
      exported: exported.map(|v| ModuleExportName::Ident(Ident::new(v, DUMMY_SP))),
      is_type_only: false,
    })],
    src: src.map(|src| Box::new(src.into())),
    type_only: false,
    asserts: None,
  })
}

fn find_referenced_locals<T: for<'a> VisitWith<Uses<'a>>>(node: &T, collect: &Collect) -> Vec<Id> {
  let mut uses = Uses {
    collect,
    uses: HashSet::new(),
  };
  node.visit_with(&mut uses);
  uses.uses.into_iter().collect()
}
struct Uses<'a> {
  collect: &'a Collect,
  uses: HashSet<Id>,
}

impl Visit for Uses<'_> {
  fn visit_ident(&mut self, ident: &Ident) {
    let id = ident.to_id();
    if id.1.has_mark(self.collect.global_mark)
      && (self.collect.decls.contains(&id) || self.collect.imports.contains_key(&id))
    {
      self.uses.insert(id);
    }
  }
}

fn get_decl_names(decl: &Decl) -> Vec<Id> {
  match decl {
    Decl::Class(v) => vec![v.ident.to_id()],
    Decl::Fn(v) => vec![v.ident.to_id()],
    Decl::Var(var) => var
      .decls
      .iter()
      .map(|var_decl| var_decl.name.as_ident().unwrap().to_id())
      .collect(),
    _ => unreachable!(),
  }
}

fn split_up_decl(decl: Decl) -> Vec<(Id, Decl)> {
  match decl {
    Decl::Class(ref v) => vec![(v.ident.to_id(), decl)],
    Decl::Fn(ref v) => vec![(v.ident.to_id(), decl)],
    Decl::Var(var) => var
      .decls
      .into_iter()
      .map(|var_decl| {
        (
          var_decl.name.as_ident().unwrap().to_id(),
          Decl::Var(Box::new(VarDecl {
            span: DUMMY_SP,
            kind: var.kind,
            declare: var.declare,
            decls: vec![var_decl],
          })),
        )
      })
      .collect(),
    _ => unreachable!(),
  }
}
