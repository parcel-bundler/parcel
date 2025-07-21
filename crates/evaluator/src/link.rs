use std::collections::HashSet;

use indexmap::IndexMap;
use parcel_core::{DependencyFlags, Priority};
use swc_core::{
  common::{Span, DUMMY_SP},
  ecma::{
    ast::*,
    atoms::Atom as JsWord,
    utils::private_ident,
    visit::{VisitMut, VisitMutWith},
  },
  quote,
};

use crate::dependencies::context::{ModuleContext, Symbol};

enum DependencyResolution {
  Module {
    id: JsWord,
  },
  BundleGroup {
    bundles: Vec<JsWord>,
    entry_module: JsWord,
  },
  Url {
    url: JsWord,
  },
  Inline {
    contents: JsWord,
  },
  External {
    specifier: JsWord,
  },
  Excluded,
}

#[derive(Clone, Debug)]
struct SymbolResolution {
  module: JsWord,
  symbol: Symbol,
}

struct Link<'a> {
  module_record: &'a ModuleContext,
  dependency_resolutions: Vec<DependencyResolution>,
  import_symbols: IndexMap<Id, SymbolResolution>,
  indirect_export_symbols: Vec<SymbolResolution>,
  used_exports: HashSet<Symbol>,
  module_namespaces: IndexMap<JsWord, Option<Ident>>,
}

impl<'a> VisitMut for Link<'a> {
  fn visit_mut_module(&mut self, node: &mut Module) {
    // Insert parcelRequire calls for each ESM dependency (in source order) to run side effects.
    for (index, dep) in self.module_record.dependencies.iter().enumerate() {
      if dep.flags.contains(DependencyFlags::IS_ESM) {
        let resolution = &self.dependency_resolutions[index];
        match resolution {
          DependencyResolution::Module { id } => {
            self.module_namespaces.entry(id.clone()).or_insert(None);
          }
          _ => {}
        }
      }
    }

    // For each import entry (symbol), ensure that a module namespace is declared.
    // These symbols are resolved directly to their target modules, through re-exports.
    // Therefore, additional module namespaces that are not imported directly may be added.
    for import in &self.module_record.import_entries {
      if let Some(resolution) = self.import_symbols.get(&import.local) {
        Self::add_module_namespace(&mut self.module_namespaces, &resolution.module);
      }
    }

    // If the namespace object was used (e.g. a non-static property was accessed),
    // add module namespaces for indirect and star export dependencies as well.
    let used_namespace = self.used_exports.contains(&Symbol::Namespace);
    if used_namespace {
      for symbol in &self.indirect_export_symbols {
        Self::add_module_namespace(&mut self.module_namespaces, &symbol.module);
      }

      for index in &self.module_record.star_exports {
        if let DependencyResolution::Module { id } = &self.dependency_resolutions[*index as usize] {
          Self::add_module_namespace(&mut self.module_namespaces, id);
        }
      }
    }

    // Now generate code to actually import the requested modules.
    let mut items = Vec::new();
    for (id, ident) in &self.module_namespaces {
      if let Some(ident) = ident {
        items.push(quote!(
          "const $ident = parcelRequire($id)" as ModuleItem,
          ident: Ident = ident.clone().into(),
          id: Expr = id.clone().into()
        ));
      } else {
        items.push(quote!(
          "parcelRequire($id)" as ModuleItem,
          id: Expr = id.clone().into()
        ));
      }
    }

    // Export live bindings for each local ESM export.
    for (export, record) in &self.module_record.local_exports {
      if used_namespace || self.used_exports.contains(&export) {
        items.push(quote!(
          "parcelRequire.e(exports, $name, () => $ident)" as ModuleItem,
          name: Expr = export.name().into(),
          ident: Expr = Ident::new(record.local.0.clone(), DUMMY_SP, record.local.1).into()
        ));
      }
    }

    // If the namespace is used, also add re-exports.
    if used_namespace {
      for (index, name) in self.module_record.indirect_exports.keys().enumerate() {
        items.push(quote!(
          "parcelRequire.e(exports, $name, () => $ident)" as ModuleItem,
          name: Expr = name.name().into(),
          ident: Expr = self.module_namespaces[&self.indirect_export_symbols[index].module].clone().unwrap().into()
        ));
      }

      for index in &self.module_record.star_exports {
        if let DependencyResolution::Module { id } = &self.dependency_resolutions[*index as usize] {
          items.push(quote!(
            "parcelRequire.a(exports, $ident)" as ModuleItem,
            ident: Expr = self.module_namespaces[id].clone().unwrap().into()
          ));
        }
      }
    }

    node.body.splice(0..0, items);

    node.visit_mut_children_with(self);
  }

  fn visit_mut_expr(&mut self, node: &mut Expr) {
    match node {
      Expr::Ident(id) => {
        // if id is an imported symbol, replace with object property access.
        // if import is constant, it could be destructured at the top of the module
        // if imported module is in the same bundle, it could be referenced directly (hoisted)

        if let Some(symbol) = self.import_symbols.get(&id.to_id()) {
          *node = self.create_import_access(symbol.clone(), id.span);
          return;
        }
      }
      Expr::Call(call) => {
        if let Callee::Expr(callee) = &call.callee {
          if let Expr::Ident(callee) = &**callee {
            if callee.sym == "__parcel_dep__" {
              if let Some(arg) = call.args.get(0) {
                if let Expr::Lit(Lit::Num(Number { value, .. })) = &*arg.expr {
                  *node = self.parcel_dep(*value as usize);
                  return;
                }
              }
            }
          }
        }
      }
      _ => {}
    }

    node.visit_mut_children_with(self);
  }

  fn visit_mut_prop(&mut self, node: &mut Prop) {
    if let Prop::Shorthand(shorthand) = node {
      if let Some(symbol) = self.import_symbols.get(&shorthand.to_id()) {
        let symbol = symbol.clone();
        *node = Prop::KeyValue(KeyValueProp {
          key: PropName::Ident(IdentName::new(shorthand.sym.clone(), DUMMY_SP)),
          value: Box::new(self.create_import_access(symbol, shorthand.span)),
        });
        return;
      }
    }

    node.visit_mut_children_with(self);
  }
}

impl<'a> Link<'a> {
  fn add_module_namespace(module_namespaces: &mut IndexMap<JsWord, Option<Ident>>, id: &JsWord) {
    match module_namespaces.get(id) {
      None | Some(None) => {
        module_namespaces.insert(id.clone(), Some(private_ident!(id.clone())));
      }
      Some(Some(_)) => {}
    }
  }

  fn parcel_dep(&mut self, dep_index: usize) -> Expr {
    let Some(dep) = self.module_record.dependencies.get(dep_index) else {
      return *Expr::undefined(DUMMY_SP);
    };

    let Some(resolution) = self.dependency_resolutions.get(dep_index) else {
      return *Expr::undefined(DUMMY_SP);
    };

    match resolution {
      DependencyResolution::Module { id } => {
        if dep.priority == Priority::Lazy {
          quote!("Promise.resolve(parcelRequire($id))" as Expr, id: Expr = id.clone().into())
        } else {
          quote!("parcelRequire($id)" as Expr, id: Expr = id.clone().into())
        }
      }
      DependencyResolution::BundleGroup {
        bundles,
        entry_module,
      } => {
        if bundles.is_empty() {
          quote!("Promise.resolve(parcelRequire($id))" as Expr, id: Expr = entry_module.clone().into())
        } else if bundles.len() == 1 {
          quote!(
            "import($url).then(() => parcelRequire($id))" as Expr,
            url: Expr = bundles[0].clone().into(),
            id: Expr = entry_module.clone().into()
          )
        } else {
          let exprs = Expr::Array(ArrayLit {
            span: DUMMY_SP,
            elems: bundles
              .iter()
              .map(|bundle| {
                Some(ExprOrSpread {
                  spread: None,
                  expr: Box::new(quote!("import($url)" as Expr, url: Expr = bundle.clone().into())),
                })
              })
              .collect(),
          });
          quote!("Promise.all($exprs).then(() => parcelRequire($id))" as Expr, exprs: Expr = exprs, id: Expr = entry_module.clone().into())
        }
      }
      DependencyResolution::Url { url } => url.clone().into(),
      DependencyResolution::Inline { contents } => todo!(),
      DependencyResolution::External { specifier } => todo!(),
      DependencyResolution::Excluded => todo!(),
    }
  }

  fn create_import_access(&mut self, res: SymbolResolution, span: Span) -> Expr {
    if res.symbol == Symbol::Namespace {
      let name = self.module_namespaces[&res.module].clone().unwrap();
      return Expr::Ident(name);
    }

    // let obj = if res.symbol == Symbol::Default {
    //   // self.get_interop_default_name(source)
    //   todo!()
    // } else {
    let obj = self.module_namespaces[&res.module].clone().unwrap();
    // };

    // (0, foo)();
    Expr::Seq(SeqExpr {
      exprs: vec![
        0.into(),
        Box::new(Expr::Member(MemberExpr {
          obj: Box::new(Expr::Ident(obj)),
          prop: MemberProp::Ident(IdentName::new(res.symbol.name(), DUMMY_SP)),
          span,
        })),
      ],
      span,
    })
  }
}

#[cfg(test)]
mod tests {
  use std::sync::Arc;

  use crate::dependencies::context::ImportEntry;

  use super::*;
  use indoc::indoc;
  use parcel_core::{Environment, SpecifierType};
  use pretty_assertions::assert_eq;
  use swc_core::common::{sync::Lrc, FileName, SourceMap};
  use swc_core::common::{Globals, SyntaxContext};
  use swc_core::ecma::codegen::to_code;
  use swc_core::ecma::parser::parse_file_as_module;
  use swc_core::ecma::transforms::base::fixer::fixer;

  fn test(
    code: &str,
    deps: Vec<(
      &str,
      SpecifierType,
      DependencyResolution,
      Vec<(Symbol, SymbolResolution)>,
    )>,
    expected: &str,
  ) {
    swc_core::common::GLOBALS.set(&Globals::new(), || {
      let source_map = Lrc::new(SourceMap::default());
      let source_file = source_map.new_source_file(Lrc::new(FileName::Anon), code.into());

      let mut recovered_errors = Vec::new();
      let mut module = parse_file_as_module(
        &source_file,
        Default::default(),
        Default::default(),
        None,
        &mut recovered_errors,
      )
      .unwrap();

      let env = Arc::new(Environment::default());
      let mut record = ModuleContext::new(env, source_map);
      let mut dependency_resolutions = Vec::new();
      let mut import_symbols = IndexMap::new();
      for (src, specifier_type, res, symbols) in deps {
        let index = match specifier_type {
          SpecifierType::Esm => record.add_import_dependency(src.into()),
          SpecifierType::Commonjs => record.add_require_dependency(src.into(), DUMMY_SP),
          SpecifierType::Url => record.add_url_dependency(src.into(), false, DUMMY_SP),
          _ => todo!(),
        };
        dependency_resolutions.push(res);

        for (sym, res) in symbols {
          let name = if matches!(sym, Symbol::Namespace | Symbol::Default) {
            src.into()
          } else {
            sym.name()
          };
          let local = (name, SyntaxContext::empty());
          record.import_entries.push(ImportEntry {
            dependency_index: index,
            import_name: sym.clone(),
            local: local.clone(),
            span: DUMMY_SP,
          });
          import_symbols.insert(local, res);
        }
      }

      let mut link = Link {
        module_record: &record,
        dependency_resolutions,
        import_symbols,
        indirect_export_symbols: Vec::new(),
        used_exports: HashSet::new(),
        module_namespaces: IndexMap::new(),
      };

      module.visit_mut_with(&mut link);
      module.visit_mut_with(&mut fixer(None));

      println!("{}", to_code(&module));
      assert_eq!(&to_code(&module), expected);
    })
  }

  #[test]
  fn test_import() {
    // import {foo} from 'foo';
    test(
      "console.log(foo)",
      vec![(
        "foo",
        SpecifierType::Esm,
        DependencyResolution::Module { id: "foo".into() },
        vec![(
          Symbol::Name("foo".into()),
          SymbolResolution {
            module: "foo".into(),
            symbol: Symbol::Name("foo".into()),
          },
        )],
      )],
      indoc! { r#"
      const foo = parcelRequire("foo");
      console.log((0, foo.foo));
      "#},
    );

    // import * as foo from 'foo';
    test(
      "console.log(foo)",
      vec![(
        "foo",
        SpecifierType::Esm,
        DependencyResolution::Module { id: "foo".into() },
        vec![(
          Symbol::Namespace,
          SymbolResolution {
            module: "foo".into(),
            symbol: Symbol::Namespace,
          },
        )],
      )],
      indoc! { r#"
      const foo = parcelRequire("foo");
      console.log(foo);
      "#},
    );

    // import foo from 'foo';
    test(
      "console.log(foo)",
      vec![(
        "foo",
        SpecifierType::Esm,
        DependencyResolution::Module { id: "foo".into() },
        vec![(
          Symbol::Default,
          SymbolResolution {
            module: "foo".into(),
            symbol: Symbol::Default,
          },
        )],
      )],
      indoc! { r#"
      const foo = parcelRequire("foo");
      console.log((0, foo.default));
      "#},
    );

    // import {foo} from 'foo';
    //   -> export {foo} from 'bar';
    test(
      "console.log(foo)",
      vec![(
        "foo",
        SpecifierType::Esm,
        DependencyResolution::Module { id: "foo".into() },
        vec![(
          Symbol::Name("foo".into()),
          SymbolResolution {
            module: "bar".into(),
            symbol: Symbol::Name("foo".into()),
          },
        )],
      )],
      indoc! { r#"
      parcelRequire("foo");
      const bar = parcelRequire("bar");
      console.log((0, bar.foo));
      "#},
    );

    // import {foo} from 'foo';
    //   -> export {foo} from 'bar';
    //   (foo is side effect free)
    test(
      "console.log(foo)",
      vec![(
        "foo",
        SpecifierType::Esm,
        DependencyResolution::Excluded,
        vec![(
          Symbol::Name("foo".into()),
          SymbolResolution {
            module: "bar".into(),
            symbol: Symbol::Name("foo".into()),
          },
        )],
      )],
      indoc! { r#"
      const bar = parcelRequire("bar");
      console.log((0, bar.foo));
      "#},
    );

    // import {foo} from 'foo';
    //   -> export {bar as foo} from 'bar';
    test(
      "console.log(foo)",
      vec![(
        "foo",
        SpecifierType::Esm,
        DependencyResolution::Module { id: "foo".into() },
        vec![(
          Symbol::Name("foo".into()),
          SymbolResolution {
            module: "bar".into(),
            symbol: Symbol::Name("bar".into()),
          },
        )],
      )],
      indoc! { r#"
      parcelRequire("foo");
      const bar = parcelRequire("bar");
      console.log((0, bar.bar));
      "#},
    );

    // import {foo} from 'foo';
    //   -> export * as foo from 'bar';
    test(
      "console.log(foo)",
      vec![(
        "foo",
        SpecifierType::Esm,
        DependencyResolution::Module { id: "foo".into() },
        vec![(
          Symbol::Name("foo".into()),
          SymbolResolution {
            module: "bar".into(),
            symbol: Symbol::Namespace,
          },
        )],
      )],
      indoc! { r#"
      parcelRequire("foo");
      const bar = parcelRequire("bar");
      console.log(bar);
      "#},
    );
  }

  #[test]
  fn test_fn_deps() {
    // require('foo')
    test(
      "let x = __parcel_dep__(0);",
      vec![(
        "foo",
        SpecifierType::Commonjs,
        DependencyResolution::Module { id: "foo".into() },
        vec![],
      )],
      indoc! { r#"
      let x = parcelRequire("foo");
      "#},
    );

    // import('foo')
    // (single bundle)
    test(
      "let x = __parcel_dep__(0);",
      vec![(
        "foo",
        SpecifierType::Commonjs,
        DependencyResolution::BundleGroup {
          bundles: vec!["foo.js".into()],
          entry_module: "foo".into(),
        },
        vec![],
      )],
      indoc! { r#"
      let x = import("foo.js").then(()=>parcelRequire("foo"));
      "#},
    );

    // import('foo')
    // (multiple bundles)
    test(
      "let x = __parcel_dep__(0);",
      vec![(
        "foo",
        SpecifierType::Commonjs,
        DependencyResolution::BundleGroup {
          bundles: vec!["foo.js".into(), "bar.js".into()],
          entry_module: "foo".into(),
        },
        vec![],
      )],
      indoc! { r#"
      let x = Promise.all([
          import("foo.js"),
          import("bar.js")
      ]).then(()=>parcelRequire("foo"));
      "#},
    );

    // import('foo')
    // (internal async)
    test(
      "let x = __parcel_dep__(0);",
      vec![(
        "foo",
        SpecifierType::Commonjs,
        DependencyResolution::BundleGroup {
          bundles: vec![],
          entry_module: "foo".into(),
        },
        vec![],
      )],
      indoc! { r#"
      let x = Promise.resolve(parcelRequire("foo"));
      "#},
    );

    // new URL('foo')
    test(
      "let x = new URL(__parcel_dep__(0));",
      vec![(
        "foo",
        SpecifierType::Url,
        DependencyResolution::Url { url: "foo".into() },
        vec![],
      )],
      indoc! { r#"
      let x = new URL("foo");
      "#},
    );
  }
}
