//! Differential oracle for CSS packaging.
//!
//! Generates random stylesheet import graphs (layer statements, layer blocks,
//! layered/conditioned/repeated imports, nested media), builds them through
//! the full pipeline, and compares the cascade semantics of the emitted file
//! against a direct simulation of browser semantics over the source graph:
//! every `@import` instance applies, layers are established at their first
//! declaration, and importance reverses layer precedence. Anonymous layers
//! have fresh identities per evaluation. External stylesheets and output bundles
//! are loaded from an in-memory registry through emitted imports; no network
//! requests are made. Each emitted stylesheet is parsed separately, preserving
//! the validity of its import prelude.
//!
//! Random builds cover supported layouts. Anonymous bundled content occurs
//! only in sheets evaluated once per page; external imports precede bundled
//! content. Unsupported layouts have explicit diagnostic tests, never skipped
//! build failures. Not yet modeled: @supports, specificity, or import cycles.
//!
//! Run more seeds with `CSS_ORACLE_SEEDS=1000`, or reproduce one failure
//! with `CSS_ORACLE_SEED=42`. On failure the temp dir is kept and printed.

use std::{collections::HashMap, sync::Arc};

use lightningcss::{
  media_query::{
    MediaCondition, MediaFeatureComparison, MediaFeatureValue, MediaList, MediaQuery, MediaType,
    Operator, Qualifier, QueryFeature,
  },
  printer::PrinterOptions,
  properties::{
    Property,
    custom::{Token, TokenOrValue},
  },
  rules::{CssRule, layer::LayerName},
  stylesheet::{ParserOptions, StyleSheet},
  traits::{IntoOwned, ToCss},
  values::length::{Length, LengthValue},
};
use parcel_core::{
  AssetType, BuildMode, BuildOptions, FileSystem, MemoryFileSystem, OsFileSystem, PathId,
};

// ───────────────────────────── deterministic rng ────────────────────────────

struct Rng(u64);

impl Rng {
  fn new(seed: u64) -> Self {
    Rng(seed.wrapping_mul(0x9E3779B97F4A7C15) | 1)
  }

  fn next(&mut self) -> u64 {
    // xorshift64*
    let mut x = self.0;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    self.0 = x;
    x.wrapping_mul(0x2545F4914F6CDD1D)
  }

  fn below(&mut self, n: usize) -> usize {
    (self.next() % n as u64) as usize
  }

  fn chance(&mut self, percent: u64) -> bool {
    self.next() % 100 < percent
  }
}

// ─────────────────────────────── source model ───────────────────────────────

const LAYER_NAMES: [&str; 3] = ["la", "lb", "lc"];
const SELECTORS: [&str; 2] = [".p0", ".p1"];
/// Media condition atoms, evaluated against `Env` below. Real correlations
/// (both widths against one viewport) are preserved on both sides.
const ATOMS: [&str; 3] = ["(min-width: 600px)", "(min-width: 1000px)", "print"];

#[derive(Clone, Debug)]
enum GenLayer {
  Named(String),
  Anonymous,
}

#[derive(Clone, Copy, Debug)]
enum ImportTarget {
  Local(usize),
  External(usize),
}

fn external_url(index: usize) -> String {
  format!("https://css-oracle.test/e{index}.css")
}

#[derive(Debug)]
enum GenRule {
  Import {
    target: ImportTarget,
    layer: Option<GenLayer>,
    media: Option<usize>,
  },
  Statement(Vec<String>),
  Block {
    name: GenLayer,
    rules: Vec<GenRule>,
  },
  Media {
    atom: usize,
    rules: Vec<GenRule>,
  },
  Style {
    selector: usize,
    value: u32,
    important: bool,
  },
}

struct GenFile {
  rules: Vec<GenRule>,
}

fn gen_statement(rng: &mut Rng) -> GenRule {
  let count = 1 + rng.below(2);
  GenRule::Statement(
    (0..count)
      .map(|_| LAYER_NAMES[rng.below(LAYER_NAMES.len())].to_string())
      .collect(),
  )
}

fn gen_layer(rng: &mut Rng, anonymous: bool) -> GenLayer {
  if anonymous && rng.chance(30) {
    GenLayer::Anonymous
  } else {
    GenLayer::Named(LAYER_NAMES[rng.below(LAYER_NAMES.len())].to_string())
  }
}

fn gen_content(rng: &mut Rng, next_value: &mut u32, depth: usize, anonymous: bool) -> GenRule {
  let choices = if depth < 2 { 6 } else { 2 };
  match rng.below(choices) {
    0 | 1 => {
      *next_value += 1;
      GenRule::Style {
        selector: rng.below(SELECTORS.len()),
        value: *next_value,
        important: rng.chance(35),
      }
    }
    2 => gen_statement(rng),
    3 | 4 => GenRule::Block {
      name: gen_layer(rng, anonymous),
      rules: (0..1 + rng.below(2))
        .map(|_| gen_content(rng, next_value, depth + 1, anonymous))
        .collect(),
    },
    _ => GenRule::Media {
      atom: rng.below(ATOMS.len()),
      rules: (0..1 + rng.below(2))
        .map(|_| gen_content(rng, next_value, depth + 1, anonymous))
        .collect(),
    },
  }
}

/// Files 0 and 1 are page entries; both import from the shared pool of
/// files `>= 2`, which form a DAG (file `i` imports only `j > i`), so
/// browser semantics need no cycle handling. Repeated imports of one file
/// (with the same or different clauses) and cross-page sharing arise
/// naturally.
const ENTRIES: usize = 2;

struct Case {
  files: Vec<GenFile>,
  external: Vec<GenFile>,
}

fn gen_files(rng: &mut Rng) -> Case {
  let count = ENTRIES + 1 + rng.below(3);
  let mut next_value = 0;
  let mut files: Vec<GenFile> = (0..count)
    .map(|i| {
      let mut rules = Vec::new();
      // @layer statements may precede @import rules but cannot interleave
      // with them (an interleaved statement ends the import region), so the
      // prefix is statements first, then imports.
      if rng.chance(30) {
        rules.push(gen_statement(rng));
      }
      let first_target = if i < ENTRIES { ENTRIES } else { i + 1 };
      if first_target < count {
        for _ in 0..1 + rng.below(3) {
          rules.push(GenRule::Import {
            target: ImportTarget::Local(first_target + rng.below(count - first_target)),
            layer: rng.chance(50).then(|| gen_layer(rng, i < ENTRIES)),
            media: rng.chance(30).then(|| rng.below(ATOMS.len())),
          });
        }
      }
      for _ in 0..1 + rng.below(3) {
        rules.push(gen_content(rng, &mut next_value, 0, i < ENTRIES));
      }
      GenFile { rules }
    })
    .collect();

  // Remote sheets are evaluated natively, so repeated anonymous content is
  // valid here. Their imports form a separate DAG in the registry.
  let external: Vec<_> = (0..3)
    .map(|i| {
      let mut rules = vec![gen_statement(rng)];
      if i < 2 {
        for _ in 0..1 + rng.below(2) {
          rules.push(GenRule::Import {
            target: ImportTarget::External(i + 1 + rng.below(2 - i)),
            layer: rng.chance(60).then(|| gen_layer(rng, true)),
            media: rng.chance(40).then(|| rng.below(ATOMS.len())),
          });
        }
      }
      for _ in 0..1 + rng.below(3) {
        rules.push(gen_content(rng, &mut next_value, 0, true));
      }
      GenFile { rules }
    })
    .collect();

  for entry in 0..ENTRIES {
    if !rng.chance(65) {
      continue;
    }
    let mut imports = Vec::new();
    for _ in 0..1 + rng.below(3) {
      imports.push(GenRule::Import {
        target: ImportTarget::External(rng.below(external.len())),
        layer: rng.chance(60).then(|| gen_layer(rng, true)),
        media: rng.chance(40).then(|| rng.below(ATOMS.len())),
      });
    }
    // Sometimes route the external imports through a local sheet, exercising
    // composition of its layer/media conditions with the surviving imports.
    if rng.chance(50) {
      imports.push(gen_content(rng, &mut next_value, 0, true));
      let target = files.len();
      files.push(GenFile { rules: imports });
      imports = vec![GenRule::Import {
        target: ImportTarget::Local(target),
        layer: rng.chance(60).then(|| gen_layer(rng, true)),
        media: rng.chance(40).then(|| rng.below(ATOMS.len())),
      }];
    }
    let prefix = files[entry]
      .rules
      .iter()
      .take_while(|r| matches!(r, GenRule::Statement(_)))
      .count();
    files[entry].rules.splice(prefix..prefix, imports);
  }
  Case { files, external }
}

fn write_rule(out: &mut String, rule: &GenRule, indent: usize) {
  let pad = "  ".repeat(indent);
  match rule {
    GenRule::Import {
      target,
      layer,
      media,
    } => {
      let url = match target {
        ImportTarget::Local(index) => format!("f{index}.css"),
        ImportTarget::External(index) => external_url(*index),
      };
      out.push_str(&format!("{pad}@import \"{url}\""));
      match layer {
        Some(GenLayer::Named(name)) => out.push_str(&format!(" layer({name})")),
        Some(GenLayer::Anonymous) => out.push_str(" layer"),
        None => {}
      }
      if let Some(atom) = media {
        out.push_str(&format!(" {}", ATOMS[*atom]));
      }
      out.push_str(";\n");
    }
    GenRule::Statement(names) => {
      out.push_str(&format!("{pad}@layer {};\n", names.join(", ")));
    }
    GenRule::Block { name, rules } => {
      match name {
        GenLayer::Named(name) => out.push_str(&format!("{pad}@layer {name} {{\n")),
        GenLayer::Anonymous => out.push_str(&format!("{pad}@layer {{\n")),
      }
      for rule in rules {
        write_rule(out, rule, indent + 1);
      }
      out.push_str(&format!("{pad}}}\n"));
    }
    GenRule::Media { atom, rules } => {
      out.push_str(&format!("{pad}@media {} {{\n", ATOMS[*atom]));
      for rule in rules {
        write_rule(out, rule, indent + 1);
      }
      out.push_str(&format!("{pad}}}\n"));
    }
    GenRule::Style {
      selector,
      value,
      important,
    } => {
      out.push_str(&format!(
        "{pad}{} {{ --c: v{value}{} }}\n",
        SELECTORS[*selector],
        if *important { " !important" } else { "" }
      ));
    }
  }
}

fn file_source(file: &GenFile) -> String {
  let mut out = String::new();
  for rule in &file.rules {
    write_rule(&mut out, rule, 0);
  }
  out
}

// ─────────────────────────── cascade semantics ──────────────────────────────

/// A media environment: one viewport and medium, so correlated width
/// conditions behave realistically.
#[derive(Clone, Copy, Debug)]
struct Env {
  width: f32,
  print: bool,
}

const ENVS: [Env; 6] = [
  Env {
    width: 400.0,
    print: false,
  },
  Env {
    width: 800.0,
    print: false,
  },
  Env {
    width: 1200.0,
    print: false,
  },
  Env {
    width: 400.0,
    print: true,
  },
  Env {
    width: 800.0,
    print: true,
  },
  Env {
    width: 1200.0,
    print: true,
  },
];

fn atom_matches(atom: usize, env: &Env) -> bool {
  match atom {
    0 => env.width >= 600.0,
    1 => env.width >= 1000.0,
    2 => env.print,
    _ => unreachable!(),
  }
}

#[derive(Clone)]
enum Cond {
  Atom(usize),
  Query(MediaList<'static>),
}

impl Cond {
  fn matches(&self, env: &Env) -> bool {
    match self {
      Cond::Atom(atom) => atom_matches(*atom, env),
      Cond::Query(list) => {
        list.media_queries.is_empty() || list.media_queries.iter().any(|q| eval_query(q, env))
      }
    }
  }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum Layer {
  Named(String),
  Anonymous(usize),
}

#[derive(Default)]
struct Identities(usize);

impl Identities {
  fn anonymous(&mut self) -> Layer {
    let id = self.0;
    self.0 += 1;
    Layer::Anonymous(id)
  }

  fn layer(&mut self, layer: &GenLayer) -> Layer {
    match layer {
      GenLayer::Named(name) => Layer::Named(name.clone()),
      GenLayer::Anonymous => self.anonymous(),
    }
  }
}

#[derive(Debug)]
enum EventKind {
  Declare(Vec<Layer>),
  Style {
    selector: String,
    path: Vec<Layer>,
    value: String,
    important: bool,
  },
}

struct Event {
  conds: Vec<Cond>,
  kind: EventKind,
}

fn eval_query(query: &MediaQuery, env: &Env) -> bool {
  let type_matches = match &query.media_type {
    MediaType::All => true,
    MediaType::Print => env.print,
    MediaType::Screen => !env.print,
    MediaType::Custom(name) => panic!("unexpected media type {name}"),
  };
  let condition = query
    .condition
    .as_ref()
    .map_or(true, |c| eval_condition(c, env));
  let result = type_matches && condition;
  match query.qualifier {
    Some(Qualifier::Not) => !result,
    _ => result,
  }
}

fn eval_condition(condition: &MediaCondition, env: &Env) -> bool {
  match condition {
    MediaCondition::Feature(feature) => eval_feature(feature, env),
    MediaCondition::Not(inner) => !eval_condition(inner, env),
    MediaCondition::Operation {
      operator,
      conditions,
    } => match operator {
      Operator::And => conditions.iter().all(|c| eval_condition(c, env)),
      Operator::Or => conditions.iter().any(|c| eval_condition(c, env)),
    },
    other => panic!(
      "unexpected media condition {:?}",
      other.to_css_string(PrinterOptions::default())
    ),
  }
}

fn feature_px(value: &MediaFeatureValue) -> f32 {
  match value {
    MediaFeatureValue::Length(Length::Value(LengthValue::Px(px))) => *px,
    other => panic!("unexpected media feature value {other:?}"),
  }
}

fn compare(width: f32, operator: MediaFeatureComparison, px: f32) -> bool {
  match operator {
    MediaFeatureComparison::Equal => width == px,
    MediaFeatureComparison::GreaterThan => width > px,
    MediaFeatureComparison::GreaterThanEqual => width >= px,
    MediaFeatureComparison::LessThan => width < px,
    MediaFeatureComparison::LessThanEqual => width <= px,
  }
}

fn eval_feature(feature: &lightningcss::media_query::MediaFeature, env: &Env) -> bool {
  match feature {
    QueryFeature::Plain { name, value } => {
      match name
        .to_css_string(PrinterOptions::default())
        .unwrap()
        .as_str()
      {
        "width" => env.width == feature_px(value),
        "min-width" => env.width >= feature_px(value),
        "max-width" => env.width <= feature_px(value),
        other => panic!("unexpected media feature {other}"),
      }
    }
    QueryFeature::Range {
      name,
      operator,
      value,
    } => match name
      .to_css_string(PrinterOptions::default())
      .unwrap()
      .as_str()
    {
      "width" => compare(env.width, *operator, feature_px(value)),
      other => panic!("unexpected media feature {other}"),
    },
    QueryFeature::Interval {
      name,
      start,
      start_operator,
      end,
      end_operator,
    } => match name
      .to_css_string(PrinterOptions::default())
      .unwrap()
      .as_str()
    {
      // (a < width < b) parses as: a OP width, width OP b.
      "width" => {
        compare(feature_px(start), *start_operator, env.width)
          && compare(env.width, *end_operator, feature_px(end))
      }
      other => panic!("unexpected media feature {other}"),
    },
    QueryFeature::Boolean { name } => panic!(
      "unexpected boolean feature {}",
      name.to_css_string(PrinterOptions::default()).unwrap()
    ),
  }
}

/// Layer declaration order per scope, from the first declaration or use of
/// each layer among the events matching the environment.
type LayerOrder = HashMap<Vec<Layer>, Vec<Layer>>;

fn register(order: &mut LayerOrder, path: &[Layer]) {
  for len in 1..=path.len() {
    let scope = path[..len - 1].to_vec();
    let segment = &path[len - 1];
    let entry = order.entry(scope).or_default();
    if !entry.contains(segment) {
      entry.push(segment.clone());
    }
  }
}

/// Importance reverses layer precedence (including implicit unlayered
/// scopes), but source order within an identical layer still runs forwards.
fn challenger_wins(
  order: &LayerOrder,
  incumbent: &[Layer],
  challenger: &[Layer],
  important: bool,
) -> bool {
  let common = incumbent
    .iter()
    .zip(challenger.iter())
    .take_while(|(a, b)| a == b)
    .count();
  let a = &incumbent[common..];
  let b = &challenger[common..];
  match (a.first(), b.first()) {
    (None, None) => true,
    (None, Some(_)) => important,
    (Some(_), None) => !important,
    (Some(a), Some(b)) => {
      let scope = &incumbent[..common];
      let siblings = &order[&scope.to_vec()];
      let ia = siblings.iter().position(|s| s == a).unwrap();
      let ib = siblings.iter().position(|s| s == b).unwrap();
      if important { ib < ia } else { ib > ia }
    }
  }
}

fn winners(events: &[Event], env: &Env) -> HashMap<String, String> {
  let mut order = LayerOrder::new();
  let matching: Vec<&Event> = events
    .iter()
    .filter(|e| e.conds.iter().all(|c| c.matches(env)))
    .collect();
  for event in &matching {
    match &event.kind {
      EventKind::Declare(path) => register(&mut order, path),
      EventKind::Style { path, .. } => register(&mut order, path),
    }
  }
  let mut result: HashMap<String, (Vec<Layer>, String, bool)> = HashMap::new();
  for event in &matching {
    if let EventKind::Style {
      selector,
      path,
      value,
      important,
    } = &event.kind
    {
      match result.get(selector) {
        Some((incumbent, _, prior_important))
          if (*prior_important && !important)
            || (*prior_important == *important
              && !challenger_wins(&order, incumbent, path, *important)) => {}
        _ => {
          result.insert(selector.clone(), (path.clone(), value.clone(), *important));
        }
      }
    }
  }
  result
    .into_iter()
    .map(|(selector, (_, value, _))| (selector, value))
    .collect()
}

// ─────────────────────── reference: browser simulation ──────────────────────

fn simulate(
  case: &Case,
  target: ImportTarget,
  path: &[Layer],
  atoms: &[usize],
  events: &mut Vec<Event>,
  ids: &mut Identities,
) {
  let conds = |atoms: &[usize]| atoms.iter().map(|&a| Cond::Atom(a)).collect::<Vec<_>>();
  let file = match target {
    ImportTarget::Local(i) => &case.files[i],
    ImportTarget::External(i) => &case.external[i],
  };
  for rule in &file.rules {
    match rule {
      GenRule::Import {
        target,
        layer,
        media,
      } => {
        let mut atoms = atoms.to_vec();
        if let Some(atom) = media {
          atoms.push(*atom);
        }
        let mut path = path.to_vec();
        if let Some(layer) = layer {
          path.push(ids.layer(layer));
          events.push(Event {
            conds: conds(&atoms),
            kind: EventKind::Declare(path.clone()),
          });
        }
        simulate(case, *target, &path, &atoms, events, ids);
      }
      other => simulate_rule(other, path, atoms, events, ids),
    }
  }
}

fn simulate_rule(
  rule: &GenRule,
  path: &[Layer],
  atoms: &[usize],
  events: &mut Vec<Event>,
  ids: &mut Identities,
) {
  let conds = |atoms: &[usize]| atoms.iter().map(|&a| Cond::Atom(a)).collect::<Vec<_>>();
  match rule {
    GenRule::Import { .. } => unreachable!("imports are top-level only"),
    GenRule::Statement(names) => {
      for name in names {
        let mut path = path.to_vec();
        path.push(Layer::Named(name.clone()));
        events.push(Event {
          conds: conds(atoms),
          kind: EventKind::Declare(path),
        });
      }
    }
    GenRule::Block { name, rules } => {
      let mut path = path.to_vec();
      path.push(ids.layer(name));
      events.push(Event {
        conds: conds(atoms),
        kind: EventKind::Declare(path.clone()),
      });
      for rule in rules {
        simulate_rule(rule, &path, atoms, events, ids);
      }
    }
    GenRule::Media { atom, rules } => {
      let mut atoms = atoms.to_vec();
      atoms.push(*atom);
      for rule in rules {
        simulate_rule(rule, path, &atoms, events, ids);
      }
    }
    GenRule::Style {
      selector,
      value,
      important,
    } => {
      events.push(Event {
        conds: conds(atoms),
        kind: EventKind::Style {
          selector: SELECTORS[*selector].to_string(),
          path: path.to_vec(),
          value: format!("v{value}"),
          important: *important,
        },
      });
    }
  }
}

// ───────────────────── extraction from the emitted file ─────────────────────

fn layer_parts(name: &LayerName) -> Vec<Layer> {
  name
    .0
    .iter()
    .map(|part| Layer::Named(part.as_ref().to_string()))
    .collect()
}

fn external_registry(external: &[GenFile]) -> HashMap<String, StyleSheet<'static>> {
  external
    .iter()
    .enumerate()
    .map(|(index, file)| {
      let code = file_source(file);
      let sheet = StyleSheet::parse(&code, ParserOptions::default())
        .unwrap()
        .into_owned();
      (external_url(index), sheet)
    })
    .collect()
}

fn extract(codes: &[String], external: &[GenFile]) -> Vec<Event> {
  let registry = external_registry(external);
  let mut events = Vec::new();
  let mut ids = Identities::default();
  for code in codes {
    let stylesheet =
      StyleSheet::parse(code, ParserOptions::default()).unwrap_or_else(|e| panic!("parse: {e}"));
    extract_rules(
      &stylesheet.rules.0,
      &[],
      &[],
      &mut events,
      &mut ids,
      &registry,
    );
  }
  events
}

fn extract_rules(
  rules: &[CssRule],
  path: &[Layer],
  conds: &[Cond],
  events: &mut Vec<Event>,
  ids: &mut Identities,
  registry: &HashMap<String, StyleSheet<'static>>,
) {
  for rule in rules {
    match rule {
      CssRule::LayerStatement(statement) => {
        for name in &statement.names {
          let mut path = path.to_vec();
          path.extend(layer_parts(name));
          events.push(Event {
            conds: conds.to_vec(),
            kind: EventKind::Declare(path),
          });
        }
      }
      CssRule::LayerBlock(block) => {
        let mut path = path.to_vec();
        match &block.name {
          Some(name) => path.extend(layer_parts(name)),
          None => path.push(ids.anonymous()),
        }
        events.push(Event {
          conds: conds.to_vec(),
          kind: EventKind::Declare(path.clone()),
        });
        extract_rules(&block.rules.0, &path, conds, events, ids, registry);
      }
      CssRule::Media(media) => {
        let mut conds = conds.to_vec();
        conds.push(Cond::Query(media.query.clone().into_owned()));
        extract_rules(&media.rules.0, path, &conds, events, ids, registry);
      }
      CssRule::Import(import) => {
        assert!(import.supports.is_none(), "supports is not modeled");
        let sheet = registry
          .get(import.url.as_ref())
          .unwrap_or_else(|| panic!("unregistered import: {}", import.url));
        let mut conds = conds.to_vec();
        conds.push(Cond::Query(import.media.clone().into_owned()));
        let mut path = path.to_vec();
        if let Some(layer) = &import.layer {
          match layer {
            Some(name) => path.extend(layer_parts(name)),
            None => path.push(ids.anonymous()),
          }
          events.push(Event {
            conds: conds.clone(),
            kind: EventKind::Declare(path.clone()),
          });
        }
        extract_rules(&sheet.rules.0, &path, &conds, events, ids, registry);
      }
      CssRule::Style(style) => {
        assert!(
          style.rules.0.is_empty(),
          "nested style rules are not modeled"
        );
        let selectors = style
          .selectors
          .to_css_string(PrinterOptions::default())
          .unwrap();
        // Read both declaration lists directly. A merged rule can contain
        // normal and important values; textual last-declaration extraction
        // would incorrectly discard the important value.
        for (important, declarations) in [
          (false, &style.declarations.declarations),
          (true, &style.declarations.important_declarations),
        ] {
          for property in declarations {
            let Property::Custom(property) = property else {
              panic!("unexpected property: {property:?}")
            };
            assert_eq!(
              property
                .name
                .to_css_string(PrinterOptions::default())
                .unwrap(),
              "--c"
            );
            let mut tokens = property.value.0.iter().filter(|t| !t.is_whitespace());
            let Some(TokenOrValue::Token(Token::Ident(value))) = tokens.next() else {
              panic!("unexpected custom property value: {:?}", property.value);
            };
            assert!(tokens.next().is_none(), "expected one identifier value");
            let value = value.to_string();
            for selector in selectors.split(',') {
              events.push(Event {
                conds: conds.to_vec(),
                kind: EventKind::Style {
                  selector: selector.trim().to_string(),
                  path: path.to_vec(),
                  value: value.clone(),
                  important,
                },
              });
            }
          }
        }
      }
      CssRule::Ignored => {}
      other => panic!(
        "unexpected rule in output: {}",
        other
          .to_css_string(PrinterOptions::default())
          .unwrap_or_else(|_| format!("{:?}", std::mem::discriminant(other)))
      ),
    }
  }
}

// ─────────────────────────────── test driver ────────────────────────────────

fn run_seed(seed: u64, mode: BuildMode) {
  let mut rng = Rng::new(seed);
  let case = gen_files(&mut rng);
  run_case(&format!("seed-{seed}"), &case, mode, None);
}

fn run_case(label: &str, case: &Case, mode: BuildMode, expected_error: Option<&str>) {
  let mode_name = match mode {
    BuildMode::Production => "prod",
    _ => "dev",
  };
  let dir = std::env::temp_dir().join(format!("parcel-css-oracle-{label}-{mode_name}"));
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).unwrap();
  std::fs::write(dir.join("package.json"), "{\n  \"private\": true\n}\n").unwrap();
  let mut sources = String::new();
  for (index, file) in case.files.iter().enumerate() {
    let source = file_source(file);
    sources.push_str(&format!("── f{index}.css ──\n{source}"));
    std::fs::write(dir.join(format!("f{index}.css")), source).unwrap();
  }
  for (index, file) in case.external.iter().enumerate() {
    let source = file_source(file);
    sources.push_str(&format!("── {} ──\n{source}", external_url(index)));
    std::fs::write(dir.join(format!("external-{index}.css")), source).unwrap();
  }
  let context = |detail: &str| format!("{label} ({mode_name}), dir {dir:?}\n{sources}\n{detail}");

  let output_fs = Arc::new(MemoryFileSystem::new());
  let mut env = HashMap::new();
  env.insert("NODE_ENV".into(), "test".into());
  let optimize = matches!(mode, BuildMode::Production);
  let options = BuildOptions {
    mode,
    optimize: Some(optimize),
    source_map: None,
    env,
    input_fs: Arc::new(OsFileSystem {}),
    output_fs: output_fs.clone(),
    log_level: parcel_core::LogLevel::Verbose,
    config: None,
    cwd: PathId::new(&dir),
    dist_dir: None,
    public_url: Default::default(),
    hmr: None,
    reporters: Vec::new(),
  };
  let entries: Vec<String> = (0..ENTRIES).map(|i| format!("f{i}.css")).collect();
  let result = parcel::build(&entries, options);
  if let Some(expected) = expected_error {
    let Err(error) = result else {
      panic!(
        "{}",
        context("expected a diagnostic, but the build succeeded")
      )
    };
    assert!(
      !error.0.is_empty() && error.0.iter().all(|d| d.message.contains(expected)),
      "{}",
      context(&format!("expected {expected:?}, got {error:?}"))
    );
    std::fs::remove_dir_all(&dir).unwrap();
    return;
  }
  let graph = result.unwrap_or_else(|e| panic!("{}", context(&format!("build failed: {e:?}"))));

  // Load only the entry stylesheet, following its emitted @imports like a
  // browser. Loading referenced_bundles here would mask missing imports.
  let mut registry = external_registry(&case.external);
  let mut code = String::new();
  for bundle in &graph.bundles {
    if bundle.ty != AssetType::Css {
      continue;
    }
    let source = output_fs.read_to_string(bundle.dist_path()).unwrap();
    code.push_str(&format!("── {} ──\n{source}\n", bundle.name()));
    let mut sheet = StyleSheet::parse(&source, ParserOptions::default())
      .unwrap()
      .into_owned();
    let url = url::Url::parse(&bundle.dist_url().to_string()).unwrap();
    for rule in &mut sheet.rules.0 {
      if let CssRule::Import(import) = rule {
        import.url = url.join(import.url.as_ref()).unwrap().to_string().into();
      }
    }
    registry.insert(url.to_string(), sheet);
  }
  for entry in 0..ENTRIES {
    let root = graph
      .bundles
      .iter()
      .find(|bundle| {
        bundle.ty == AssetType::Css
          && bundle.main_entry_asset.is_some_and(|asset| {
            format!("{:?}", graph.asset_graph.asset(asset).loc.url)
              .contains(&format!("/f{entry}.css"))
          })
      })
      .unwrap_or_else(|| panic!("{}", context(&format!("no bundle for entry {entry}"))));
    let mut reference = Vec::new();
    simulate(
      case,
      ImportTarget::Local(entry),
      &[],
      &[],
      &mut reference,
      &mut Identities::default(),
    );
    let mut actual = Vec::new();
    extract_rules(
      &registry[&root.dist_url().to_string()].rules.0,
      &[],
      &[],
      &mut actual,
      &mut Identities::default(),
      &registry,
    );

    for env in ENVS {
      let expected = winners(&reference, &env);
      let got = winners(&actual, &env);
      if expected != got {
        panic!(
          "{}",
          context(&format!(
            "── page f{entry} output ──\n{code}\n\ncascade mismatch under {env:?}\nbrowser semantics: {expected:?}\npackaged output:   {got:?}"
          ))
        );
      }
    }
  }

  let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn css_packaging_matches_browser_semantics() {
  if let Ok(seed) = std::env::var("CSS_ORACLE_SEED") {
    let seed: u64 = seed.parse().unwrap();
    run_seed(seed, BuildMode::Production);
    run_seed(seed, BuildMode::Development);
    return;
  }
  let seeds: u64 = std::env::var("CSS_ORACLE_SEEDS")
    .ok()
    .and_then(|s| s.parse().ok())
    .unwrap_or(64);
  for seed in 0..seeds {
    run_seed(seed, BuildMode::Production);
    if seed % 4 == 0 {
      run_seed(seed, BuildMode::Development);
    }
  }
}

#[test]
fn importance_and_layer_precedence() {
  // Hand-calculated outcomes guard the reference evaluator itself, including
  // the implicit unlayered sublayer at each level of nesting.
  for (source, expected) in [
    (".p0 { --c: first !important; --c: later }", "first"),
    (
      ".p0 { --c: first !important; --c: later !important }",
      "later",
    ),
    (
      "@layer a,b; @layer a { .p0 { --c: a } } @layer b { .p0 { --c: b } }",
      "b",
    ),
    (
      "@layer a,b; @layer a { .p0 { --c: a !important } } @layer b { .p0 { --c: b !important } }",
      "a",
    ),
    (
      "@layer a { .p0 { --c: layered !important } } .p0 { --c: plain !important }",
      "layered",
    ),
    (
      "@layer a { .p0 { --c: plain !important } @layer b { .p0 { --c: nested !important } } }",
      "nested",
    ),
    (
      "@layer a { @layer b { .p0 { --c: nested } } .p0 { --c: plain } }",
      "plain",
    ),
    (
      "@layer { .p0 { --c: first !important } } @layer { .p0 { --c: second !important } }",
      "first",
    ),
    (
      "@layer { .p0 { --c: first } } @layer { .p0 { --c: second } }",
      "second",
    ),
  ] {
    let events = extract(&[source.to_string()], &[]);
    assert_eq!(winners(&events, &ENVS[0])[".p0"], expected, "{source}");
  }
}

fn style(selector: usize, value: u32, important: bool) -> GenRule {
  GenRule::Style {
    selector,
    value,
    important,
  }
}

fn import(target: ImportTarget, layer: Option<GenLayer>, media: Option<usize>) -> GenRule {
  GenRule::Import {
    target,
    layer,
    media,
  }
}

fn case_with_entry(
  rules: Vec<GenRule>,
  dependencies: Vec<GenFile>,
  external: Vec<GenFile>,
) -> Case {
  let mut files = vec![
    GenFile { rules },
    GenFile {
      rules: vec![style(1, 999, false)],
    },
  ];
  files.extend(dependencies);
  Case { files, external }
}

#[test]
fn repeated_external_anonymous_layers_are_fresh() {
  let case = case_with_entry(
    vec![
      import(ImportTarget::External(0), None, None),
      import(ImportTarget::External(1), None, None),
      import(ImportTarget::External(0), None, None),
    ],
    vec![],
    (0..2)
      .map(|i| GenFile {
        rules: vec![GenRule::Block {
          name: GenLayer::Anonymous,
          rules: vec![style(0, 1 + i, false), style(1, 3 + i, true)],
        }],
      })
      .collect(),
  );
  let mut reference = Vec::new();
  simulate(
    &case,
    ImportTarget::Local(0),
    &[],
    &[],
    &mut reference,
    &mut Identities::default(),
  );
  // Fresh layers make the last occurrence win normal declarations, and the
  // first occurrence win important ones. Neither per-file layer identities
  // nor deduplicating the repeated import can satisfy both assertions.
  let expected = HashMap::from([(".p0".into(), "v1".into()), (".p1".into(), "v3".into())]);
  assert_eq!(winners(&reference, &ENVS[0]), expected);
  let actual = extract(&[file_source(&case.files[0])], &case.external);
  assert_eq!(winners(&actual, &ENVS[0]), expected);
  for mode in [BuildMode::Production, BuildMode::Development] {
    run_case("repeated-external-anonymous", &case, mode, None);
  }
}

#[test]
fn anonymous_import_clauses_remain_distinct() {
  let case = case_with_entry(
    vec![
      import(ImportTarget::Local(2), Some(GenLayer::Anonymous), None),
      import(ImportTarget::Local(3), Some(GenLayer::Anonymous), None),
      import(ImportTarget::Local(2), Some(GenLayer::Anonymous), None),
    ],
    vec![
      GenFile {
        rules: vec![style(0, 1, true), style(1, 2, false)],
      },
      GenFile {
        rules: vec![style(0, 3, true), style(1, 4, false)],
      },
    ],
    vec![],
  );
  for mode in [BuildMode::Production, BuildMode::Development] {
    run_case("anonymous-import-clauses", &case, mode, None);
  }
}

#[test]
fn stylesheet_boundaries_preserve_external_imports() {
  let external = vec![GenFile {
    rules: vec![style(0, 2, false)],
  }];
  let events = extract(
    &[
      ".p0 { --c: v1 }".into(),
      format!("@import '{}';", external_url(0)),
    ],
    &external,
  );
  assert_eq!(winners(&events, &ENVS[0])[".p0"], "v2");
}

#[test]
fn unsupported_import_layouts_are_diagnostics() {
  let anonymous_block = case_with_entry(
    vec![
      import(ImportTarget::Local(2), None, None),
      import(ImportTarget::Local(2), None, None),
    ],
    vec![GenFile {
      rules: vec![GenRule::Block {
        name: GenLayer::Anonymous,
        rules: vec![style(0, 1, true)],
      }],
    }],
    vec![],
  );
  let anonymous_clause = case_with_entry(
    vec![
      import(ImportTarget::Local(2), None, None),
      import(ImportTarget::Local(2), None, None),
    ],
    vec![
      GenFile {
        rules: vec![import(
          ImportTarget::Local(3),
          Some(GenLayer::Anonymous),
          None,
        )],
      },
      GenFile {
        rules: vec![style(0, 1, true)],
      },
    ],
    vec![],
  );
  let late_external = case_with_entry(
    vec![
      import(ImportTarget::Local(2), None, None),
      import(ImportTarget::External(0), None, None),
    ],
    vec![GenFile {
      rules: vec![style(0, 1, false)],
    }],
    vec![GenFile {
      rules: vec![style(0, 2, false)],
    }],
  );
  for mode in [BuildMode::Production, BuildMode::Development] {
    for (label, case, diagnostic) in [
      (
        "repeated-anonymous-block",
        &anonymous_block,
        "every occurrence of an anonymous layer is a distinct layer",
      ),
      (
        "repeated-anonymous-clause",
        &anonymous_clause,
        "every occurrence of an anonymous layer is a distinct layer",
      ),
      (
        "late-external",
        &late_external,
        "cannot preserve its cascade position",
      ),
    ] {
      run_case(label, case, mode.clone(), Some(diagnostic));
    }
  }
}

#[test]
fn external_imports_compose_media_and_layers() {
  let case = case_with_entry(
    vec![
      import(
        ImportTarget::Local(2),
        Some(GenLayer::Named("outer".into())),
        Some(0),
      ),
      style(0, 2, true),
    ],
    vec![GenFile {
      rules: vec![import(
        ImportTarget::External(0),
        Some(GenLayer::Anonymous),
        Some(1),
      )],
    }],
    vec![GenFile {
      rules: vec![GenRule::Block {
        name: GenLayer::Anonymous,
        rules: vec![style(0, 1, true)],
      }],
    }],
  );
  let mut reference = Vec::new();
  simulate(
    &case,
    ImportTarget::Local(0),
    &[],
    &[],
    &mut reference,
    &mut Identities::default(),
  );
  for env in ENVS {
    assert_eq!(
      winners(&reference, &env)[".p0"],
      if env.width >= 1000.0 { "v1" } else { "v2" }
    );
  }
  for mode in [BuildMode::Production, BuildMode::Development] {
    run_case("external-composed-conditions", &case, mode, None);
  }
}

#[test]
fn external_import_precedes_shared_css() {
  let mut case = case_with_entry(
    vec![
      import(ImportTarget::External(0), Some(GenLayer::Anonymous), None),
      import(ImportTarget::Local(2), None, None),
    ],
    vec![GenFile {
      rules: vec![GenRule::Block {
        name: GenLayer::Named("local".into()),
        rules: vec![style(0, 2, false)],
      }],
    }],
    vec![GenFile {
      rules: vec![style(0, 1, false)],
    }],
  );
  case.files[1].rules = vec![import(ImportTarget::Local(2), None, None)];
  for mode in [BuildMode::Production, BuildMode::Development] {
    run_case("external-before-shared-css", &case, mode, None);
  }
}

#[test]
fn css_entry_imports_shared_bundles_in_order() {
  let case = Case {
    files: vec![
      GenFile {
        rules: vec![
          import(ImportTarget::Local(2), None, None),
          import(ImportTarget::Local(3), None, None),
          import(ImportTarget::Local(4), None, None),
        ],
      },
      GenFile {
        rules: vec![
          import(ImportTarget::Local(2), None, None),
          import(ImportTarget::Local(4), None, None),
        ],
      },
      GenFile {
        rules: vec![
          style(0, 1, false),
          GenRule::Block {
            name: GenLayer::Named("first".into()),
            rules: vec![style(1, 1, true)],
          },
        ],
      },
      GenFile {
        rules: vec![style(0, 2, false)],
      },
      GenFile {
        rules: vec![
          style(0, 3, false),
          GenRule::Block {
            name: GenLayer::Named("second".into()),
            rules: vec![style(1, 3, true)],
          },
        ],
      },
    ],
    external: vec![],
  };
  for mode in [BuildMode::Production, BuildMode::Development] {
    run_case("entry-shared-bundle-order", &case, mode, None);
  }
}

#[test]
fn shared_css_precedes_external_import() {
  let mut case = case_with_entry(
    vec![
      import(ImportTarget::Local(2), None, None),
      import(ImportTarget::External(0), None, None),
    ],
    vec![GenFile {
      rules: vec![style(0, 1, false)],
    }],
    vec![GenFile {
      rules: vec![style(0, 2, false)],
    }],
  );
  case.files[1].rules = vec![import(ImportTarget::Local(2), None, None)];
  for mode in [BuildMode::Production, BuildMode::Development] {
    run_case("shared-css-before-external", &case, mode, None);
  }
}
