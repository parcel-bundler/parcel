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
  common::{
    sync::Lrc, util::take::Take, FileName, SourceMap, Span, Spanned, SyntaxContext, DUMMY_SP,
  },
  ecma::{
    ast::{Module as SwcModule, ModuleDecl, ModuleItem, *},
    atoms::Atom as JsWord,
    utils::{for_each_binding_ident, private_ident},
  },
  quote,
};

trait ModuleRecord {}

// https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-source-text-module-records
struct SourceTextModuleRecord {
  pub import_entries: Vec<ImportEntry>,
  pub local_exports: IndexMap<Symbol, LocalExportRecord>,
  pub indirect_exports: IndexMap<Symbol, IndirectExportRecord>,
  pub star_exports: Vec<u32>,
}

pub struct ImportEntry {
  pub dependency_index: u32,
  pub import_name: Symbol,
  pub local: Id,
  pub span: Span,
}

pub struct LocalExportRecord {
  pub local: Id,
  pub span: Span,
}

pub struct IndirectExportRecord {
  pub dependency_index: u32,
  pub import_name: Symbol,
  pub span: Span,
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

impl Symbol {
  pub fn name(&self) -> JsWord {
    match self {
      Symbol::Name(name) => name.clone(),
      Symbol::Default => "default".into(),
      _ => unreachable!(),
    }
  }
}
