//! Differential oracle for CSS packaging.
//!
//! Generates random stylesheet import graphs (layer statements, layer blocks,
//! layered/conditioned/repeated imports, nested media), builds them through
//! the full pipeline, and compares the cascade semantics of the emitted file
//! against a direct simulation of browser semantics over the source graph:
//! every `@import` instance applies, layers are established at their first
//! declaration, and later layers win normal declarations. The observable
//! compared is the winning value per selector under each media environment.
//!
//! Not yet modeled (excluded from generation): `!important` (inverts layer
//! priority), anonymous layers (each browser evaluation creates a fresh
//! layer, while bundling merges per-site), `@supports`, external imports,
//! and multi-bundle splits.
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

#[derive(Debug)]
enum GenRule {
  Import {
    target: usize,
    layer: Option<String>,
    media: Option<usize>,
  },
  Statement(Vec<String>),
  Block {
    name: String,
    rules: Vec<GenRule>,
  },
  Media {
    atom: usize,
    rules: Vec<GenRule>,
  },
  Style {
    selector: usize,
    value: u32,
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

fn gen_content(rng: &mut Rng, next_value: &mut u32, depth: usize) -> GenRule {
  let choices = if depth < 2 { 6 } else { 2 };
  match rng.below(choices) {
    0 | 1 => {
      *next_value += 1;
      GenRule::Style {
        selector: rng.below(SELECTORS.len()),
        value: *next_value,
      }
    }
    2 => gen_statement(rng),
    3 | 4 => GenRule::Block {
      name: LAYER_NAMES[rng.below(LAYER_NAMES.len())].to_string(),
      rules: (0..1 + rng.below(2))
        .map(|_| gen_content(rng, next_value, depth + 1))
        .collect(),
    },
    _ => GenRule::Media {
      atom: rng.below(ATOMS.len()),
      rules: (0..1 + rng.below(2))
        .map(|_| gen_content(rng, next_value, depth + 1))
        .collect(),
    },
  }
}

/// Files form a DAG: file `i` imports only files `j > i`, so browser
/// semantics need no cycle handling. Repeated imports of one file (with the
/// same or different clauses) arise naturally.
fn gen_files(rng: &mut Rng) -> Vec<GenFile> {
  let count = 2 + rng.below(4);
  let mut next_value = 0;
  (0..count)
    .map(|i| {
      let mut rules = Vec::new();
      // @layer statements may precede @import rules but cannot interleave
      // with them (an interleaved statement ends the import region), so the
      // prefix is statements first, then imports.
      if rng.chance(30) {
        rules.push(gen_statement(rng));
      }
      if i + 1 < count {
        for _ in 0..1 + rng.below(3) {
          rules.push(GenRule::Import {
            target: i + 1 + rng.below(count - i - 1),
            layer: rng
              .chance(50)
              .then(|| LAYER_NAMES[rng.below(LAYER_NAMES.len())].to_string()),
            media: rng.chance(30).then(|| rng.below(ATOMS.len())),
          });
        }
      }
      for _ in 0..1 + rng.below(3) {
        rules.push(gen_content(rng, &mut next_value, 0));
      }
      GenFile { rules }
    })
    .collect()
}

fn write_rule(out: &mut String, rule: &GenRule, indent: usize) {
  let pad = "  ".repeat(indent);
  match rule {
    GenRule::Import {
      target,
      layer,
      media,
    } => {
      out.push_str(&format!("{pad}@import \"f{target}.css\""));
      if let Some(layer) = layer {
        out.push_str(&format!(" layer({layer})"));
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
      out.push_str(&format!("{pad}@layer {name} {{\n"));
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
    GenRule::Style { selector, value } => {
      out.push_str(&format!(
        "{pad}{} {{ --c: v{value} }}\n",
        SELECTORS[*selector]
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
      Cond::Query(list) => list.media_queries.iter().any(|q| eval_query(q, env)),
    }
  }
}

#[derive(Debug)]
enum EventKind {
  Declare(Vec<String>),
  Style {
    selector: String,
    path: Vec<String>,
    value: String,
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
type LayerOrder = HashMap<Vec<String>, Vec<String>>;

fn register(order: &mut LayerOrder, path: &[String]) {
  for len in 1..=path.len() {
    let scope = path[..len - 1].to_vec();
    let segment = &path[len - 1];
    let entry = order.entry(scope).or_default();
    if !entry.contains(segment) {
      entry.push(segment.clone());
    }
  }
}

/// Whether `challenger` wins against `incumbent` for a NORMAL declaration
/// appearing later in the event stream. Unlayered (or less-nested at the
/// point of divergence) styles win; between sibling layers the later
/// declared wins; within one layer the later event wins.
fn challenger_wins(order: &LayerOrder, incumbent: &[String], challenger: &[String]) -> bool {
  let common = incumbent
    .iter()
    .zip(challenger.iter())
    .take_while(|(a, b)| a == b)
    .count();
  let a = &incumbent[common..];
  let b = &challenger[common..];
  match (a.first(), b.first()) {
    (None, None) => true,
    (None, Some(_)) => false,
    (Some(_), None) => true,
    (Some(a), Some(b)) => {
      let scope = &incumbent[..common];
      let siblings = &order[&scope.to_vec()];
      let ia = siblings.iter().position(|s| s == a).unwrap();
      let ib = siblings.iter().position(|s| s == b).unwrap();
      ib > ia
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
  let mut result: HashMap<String, (Vec<String>, String)> = HashMap::new();
  for event in &matching {
    if let EventKind::Style {
      selector,
      path,
      value,
    } = &event.kind
    {
      match result.get(selector) {
        Some((incumbent, _)) if !challenger_wins(&order, incumbent, path) => {}
        _ => {
          result.insert(selector.clone(), (path.clone(), value.clone()));
        }
      }
    }
  }
  result
    .into_iter()
    .map(|(selector, (_, value))| (selector, value))
    .collect()
}

// ─────────────────────── reference: browser simulation ──────────────────────

fn simulate(
  files: &[GenFile],
  index: usize,
  path: &[String],
  atoms: &[usize],
  events: &mut Vec<Event>,
) {
  let conds = |atoms: &[usize]| atoms.iter().map(|&a| Cond::Atom(a)).collect::<Vec<_>>();
  for rule in &files[index].rules {
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
          path.push(layer.clone());
          events.push(Event {
            conds: conds(&atoms),
            kind: EventKind::Declare(path.clone()),
          });
        }
        simulate(files, *target, &path, &atoms, events);
      }
      other => simulate_rule(other, path, atoms, events),
    }
  }
}

fn simulate_rule(rule: &GenRule, path: &[String], atoms: &[usize], events: &mut Vec<Event>) {
  let conds = |atoms: &[usize]| atoms.iter().map(|&a| Cond::Atom(a)).collect::<Vec<_>>();
  match rule {
    GenRule::Import { .. } => unreachable!("imports are top-level only"),
    GenRule::Statement(names) => {
      for name in names {
        let mut path = path.to_vec();
        path.push(name.clone());
        events.push(Event {
          conds: conds(atoms),
          kind: EventKind::Declare(path),
        });
      }
    }
    GenRule::Block { name, rules } => {
      let mut path = path.to_vec();
      path.push(name.clone());
      events.push(Event {
        conds: conds(atoms),
        kind: EventKind::Declare(path.clone()),
      });
      for rule in rules {
        simulate_rule(rule, &path, atoms, events);
      }
    }
    GenRule::Media { atom, rules } => {
      let mut atoms = atoms.to_vec();
      atoms.push(*atom);
      for rule in rules {
        simulate_rule(rule, path, &atoms, events);
      }
    }
    GenRule::Style { selector, value } => {
      events.push(Event {
        conds: conds(atoms),
        kind: EventKind::Style {
          selector: SELECTORS[*selector].to_string(),
          path: path.to_vec(),
          value: format!("v{value}"),
        },
      });
    }
  }
}

// ───────────────────── extraction from the emitted file ─────────────────────

fn layer_parts(name: &LayerName) -> Vec<String> {
  name
    .0
    .iter()
    .map(|part| part.as_ref().to_string())
    .collect()
}

fn extract(code: &str) -> Vec<Event> {
  let stylesheet =
    StyleSheet::parse(code, ParserOptions::default()).unwrap_or_else(|e| panic!("parse: {e}"));
  let mut events = Vec::new();
  extract_rules(&stylesheet.rules.0, &[], &[], &mut events);
  events
}

fn extract_rules(rules: &[CssRule], path: &[String], conds: &[Cond], events: &mut Vec<Event>) {
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
          None => panic!("unexpected anonymous layer block in output"),
        }
        events.push(Event {
          conds: conds.to_vec(),
          kind: EventKind::Declare(path.clone()),
        });
        extract_rules(&block.rules.0, &path, conds, events);
      }
      CssRule::Media(media) => {
        let mut conds = conds.to_vec();
        conds.push(Cond::Query(media.query.clone().into_owned()));
        extract_rules(&media.rules.0, path, &conds, events);
      }
      CssRule::Style(style) => {
        let css = style
          .to_css_string(PrinterOptions::default())
          .unwrap_or_else(|e| panic!("serialize: {e}"));
        let (selectors, body) = css.split_once('{').unwrap();
        // A rule may hold several --c declarations if the minifier merged
        // adjacent same-selector rules; the last one wins, matching the
        // cascade. Selector lists cannot appear: the minifier only merges
        // selectors of rules with identical declarations, and every
        // generated value is unique.
        assert!(body.contains("--c:"), "style rule without --c: {css}");
        let value = body
          .rsplit("--c:")
          .next()
          .unwrap()
          .trim_start()
          .chars()
          .take_while(|c| c.is_ascii_alphanumeric())
          .collect::<String>();
        for selector in selectors.split(',') {
          events.push(Event {
            conds: conds.to_vec(),
            kind: EventKind::Style {
              selector: selector.trim().to_string(),
              path: path.to_vec(),
              value: value.clone(),
            },
          });
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
  let files = gen_files(&mut rng);

  let mode_name = match mode {
    BuildMode::Production => "prod",
    _ => "dev",
  };
  let dir = std::env::temp_dir().join(format!("parcel-css-oracle-{seed}-{mode_name}"));
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).unwrap();
  std::fs::write(dir.join("package.json"), "{\n  \"private\": true\n}\n").unwrap();
  let mut sources = String::new();
  for (index, file) in files.iter().enumerate() {
    let source = file_source(file);
    sources.push_str(&format!("── f{index}.css ──\n{source}"));
    std::fs::write(dir.join(format!("f{index}.css")), source).unwrap();
  }
  let context =
    |detail: &str| format!("seed {seed} ({mode_name}), dir {dir:?}\n{sources}\n{detail}");

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
  };
  let graph = parcel::build(&vec!["f0.css".into()], options)
    .unwrap_or_else(|e| panic!("{}", context(&format!("build failed: {e:?}"))));
  let css: Vec<_> = graph
    .bundles
    .iter()
    .filter(|bundle| bundle.ty == AssetType::Css)
    .collect();
  assert_eq!(css.len(), 1, "{}", context("expected one css bundle"));
  let code = output_fs.read_to_string(css[0].dist_path()).unwrap();
  if std::env::var("CSS_ORACLE_SEED").is_ok() {
    for &asset in &css[0].assets {
      let a = graph.asset_graph.asset(asset);
      eprintln!("asset {:?} cond {:?}", a.loc.url, a.target.style_condition);
    }
  }

  let mut reference = Vec::new();
  simulate(&files, 0, &[], &[], &mut reference);
  let actual = extract(&code);

  for env in ENVS {
    let expected = winners(&reference, &env);
    let got = winners(&actual, &env);
    if expected != got {
      panic!(
        "{}",
        context(&format!(
          "── output ──\n{code}\n\ncascade mismatch under {env:?}\nbrowser semantics: {expected:?}\npackaged output:   {got:?}"
        ))
      );
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
