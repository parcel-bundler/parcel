use std::{
  collections::{HashMap, HashSet},
  sync::Arc,
};

use parcel_core::{Dependency, Diagnostic, Environment, Location, SourceLocation};
use swc_core::{
  common::{sync::Lrc, FileName, Mark, SourceMap, Span},
  ecma::atoms::Atom as JsWord,
};

use crate::JsValue;

pub struct Module {
  pub env: Arc<Environment>,
  pub source_map: Lrc<SourceMap>,
  // pub deps: Vec<Dependency>,
  // pub dep_symbols: HashSet<DepSymbol>,
  pub deps: HashMap<JsWord, JsValue>,
  pub diagnostics: Vec<Diagnostic>,
  pub unresolved_mark: Mark,
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct DepSymbol {
  dep: usize,
  symbol: SymbolName,
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum SymbolName {
  Namespace,
  AllButDefault,
  Default,
  Name(JsWord),
}

impl Module {
  // pub fn add_dep(&mut self, dep: Dependency) -> usize {
  //   let index = self.deps.len();
  //   self.deps.push(dep);
  //   index
  // }

  // pub fn add_dep_symbol(&mut self, dep: usize, symbol: SymbolName) {
  //   let sym = DepSymbol { dep, symbol };
  //   self.dep_symbols.insert(sym);
  // }

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
}
