use std::{
  collections::{HashMap, HashSet},
  path::Path,
  sync::Arc,
};

use lightningcss::{
  media_query::MediaList,
  printer::PrinterOptions,
  rules::{
    CssRule, CssRuleList,
    layer::{LayerBlockRule, LayerName},
    media::MediaRule,
    supports::{SupportsCondition, SupportsRule},
  },
  stylesheet::{MinifyOptions, ParserOptions, StyleSheet},
  targets::{Browsers, Targets},
  traits::{IntoOwned, Parse, ToCss},
  visitor::Visit,
};
use parcel_core::*;
use parcel_sourcemap::SourceMap;

use crate::{
  CssContent, StyleAttrContent, convert_error, convert_version, resolve_css_module_export,
};

struct StyleSheetWrapper {
  asset_index: AssetIndex,
  stylesheet: StyleSheet<'static>,
  loc: lightningcss::rules::Location,
  parent_stylesheet_index: usize,
  parent_dep_index: usize,
}

impl CssContent {
  pub(crate) fn package_impl(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    let mut asset_index_to_stylesheet_index: HashMap<AssetIndex, usize> = HashMap::new();
    let mut stylesheets = Vec::new();
    let mut source_map = SourceMap::new("/");

    for asset_index in &bundle.assets {
      let asset = &bundle_graph.asset_graph.asset(*asset_index);
      if let Some(content) = asset.content.downcast_ref::<CssContent>() {
        asset_index_to_stylesheet_index.insert(*asset_index, stylesheets.len());
        let source_index = stylesheets.len() as u32;
        stylesheets.push(StyleSheetWrapper {
          asset_index: *asset_index,
          stylesheet: content.stylesheet.clone(),
          parent_stylesheet_index: 0,
          parent_dep_index: 0,
          loc: lightningcss::rules::Location {
            source_index,
            line: asset.loc.start.line,
            column: asset.loc.start.column + 1,
          },
        });
      } else {
        unreachable!("expected a CSS asset")
      }
    }

    let mut visited: Vec<bool> = vec![false; stylesheets.len()];
    for index in 0..stylesheets.len() {
      if !visited[index] {
        collect(
          &bundle_graph,
          &asset_index_to_stylesheet_index,
          &mut stylesheets,
          index,
          0,
          0,
          &mut visited,
        )?;
      }
    }

    let mut dest = Vec::new();
    // @import rules are only valid before all other rules, but bundle asset
    // order is application order (imports before their importer), so external
    // and cross-bundle imports that survive to the output are hoisted to a
    // prefix ahead of the inlined rules.
    let mut prefix = Vec::new();
    let mut visited = vec![false; stylesheets.len()];
    for source_index in 0..stylesheets.len() {
      if !visited[source_index] {
        inline(
          &bundle_graph,
          &bundle,
          &get_inline_bundle_content,
          &asset_index_to_stylesheet_index,
          &mut stylesheets,
          source_index,
          &mut visited,
          &mut prefix,
          &mut dest,
        )?;
      }
    }
    prefix.append(&mut dest);
    let dest = prefix;

    let mut stylesheet = StyleSheet::new(
      stylesheets
        .iter()
        .flat_map(|s| s.stylesheet.sources.clone())
        .collect(),
      CssRuleList(dest),
      ParserOptions {
        ..Default::default()
      },
    );

    stylesheet.source_map_urls = stylesheets
      .iter()
      .flat_map(|s| s.stylesheet.source_map_urls.clone())
      .collect();

    stylesheet
      .minify(Default::default())
      .map_err(|err| convert_error(None, err))?;

    let res = stylesheet
      .to_css(PrinterOptions {
        minify: bundle
          .target
          .flags
          .contains(EnvironmentFlags::SHOULD_OPTIMIZE),
        targets: Targets {
          browsers: if bundle.target.environment.is_browser() {
            let browsers = &bundle.target.engines.browsers;
            Some(Browsers {
              chrome: browsers.chrome.map(convert_version),
              firefox: browsers.firefox.map(convert_version),
              safari: browsers.safari.map(convert_version),
              ie: browsers.ie.map(convert_version),
              ios_saf: browsers.ios_saf.map(convert_version),
              android: browsers.android.map(convert_version),
              edge: browsers.edge.map(convert_version),
              opera: browsers.opera.map(convert_version),
              samsung: browsers.samsung.map(convert_version),
            })
          } else {
            None
          },
          ..Default::default()
        },
        source_map: if bundle.target.source_map.is_some() {
          Some(&mut source_map)
        } else {
          None
        },
        pseudo_classes: self.pseudo_classes.as_ref().map(|p| {
          lightningcss::printer::PseudoClasses {
            active: p.active.as_ref().map(|s| s.as_str()),
            focus: p.focus.as_ref().map(|s| s.as_str()),
            focus_visible: p.focus_visible.as_ref().map(|s| s.as_str()),
            focus_within: p.focus_within.as_ref().map(|s| s.as_str()),
            hover: p.hover.as_ref().map(|s| s.as_str()),
          }
        }),
        ..Default::default()
      })
      .map_err(|err| convert_error(None, err))?;

    if bundle.target.source_map.is_some() {
      for source_index in 0..source_map.get_sources().len() {
        if matches!(source_map.get_source_content(source_index as u32), Ok(s) if s.len() == 0) {
          let path = source_map.get_source(source_index as u32).unwrap();
          if let Ok(code) = options
            .input_fs
            .read_to_string(options.project_root.join(Path::new(path)))
          {
            let _ = source_map.set_source_content(source_index, &code);
          }
        }
      }
      let map = source_map
        .to_json(None)
        .map_err(|e| Diagnostic::from_message(e.to_string()))?;
      Ok(Arc::new(ContentWithSourceMap::new_string(
        res.code,
        map.into_bytes(),
      )))
    } else {
      Ok(Arc::new(BufferContent::new_string(res.code)))
    }
  }
}

fn collect(
  bundle_graph: &BundleGraph,
  asset_index_to_stylesheet_index: &HashMap<AssetIndex, usize>,
  stylesheets: &mut Vec<StyleSheetWrapper>,
  stylesheet_index: usize,
  parent_stylesheet_index: usize,
  parent_dep_index: usize,
  visited: &mut Vec<bool>,
) -> Result<(), DiagnosticList> {
  let stylesheet = &mut stylesheets[stylesheet_index];

  // In browsers, every instance of an @import is evaluated, so we preserve the last.
  // Conditions do not need tracking here: each accumulated @import condition is a
  // separate asset, wrapped from its own target when inlined.
  stylesheet.parent_stylesheet_index = parent_stylesheet_index;
  stylesheet.parent_dep_index = parent_dep_index;

  if visited[stylesheet_index] {
    return Ok(());
  }

  visited[stylesheet_index] = true;

  let asset_index = stylesheet.asset_index;
  let asset = &bundle_graph.asset_graph.asset(asset_index);
  let content = asset.content.downcast_ref::<CssContent>().unwrap();

  let mut unused_symbols = HashSet::new();
  for export in &asset.symbols.exports {
    if !export.requested {
      unused_symbols.insert(export.exported.as_str().to_owned());
    }
  }

  if !unused_symbols.is_empty() {
    stylesheet
      .stylesheet
      .minify(MinifyOptions {
        targets: Default::default(),
        unused_symbols,
      })
      .map_err(|err| convert_error(Some(asset.loc.url.clone()), err))?;
  }

  let mut dep_index = 0;
  for rule in &content.stylesheet.rules.0 {
    match &rule {
      CssRule::Import(_) => {
        if let BundleGraphDependencyResolution::Asset(asset_index) =
          bundle_graph.dependency_resolution(asset_index, dep_index)
        {
          if let Some(child_index) = asset_index_to_stylesheet_index.get(&asset_index) {
            collect(
              bundle_graph,
              asset_index_to_stylesheet_index,
              stylesheets,
              *child_index,
              stylesheet_index,
              dep_index,
              visited,
            )?;
          }
        }
        dep_index += 1;
      }
      CssRule::LayerStatement(_) => continue,
      _ => break,
    }
  }

  Ok(())
}

fn inline(
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
  get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
  asset_index_to_stylesheet_index: &HashMap<AssetIndex, usize>,
  stylesheets: &mut Vec<StyleSheetWrapper>,
  stylesheet_index: usize,
  visited: &mut Vec<bool>,
  prefix: &mut Vec<CssRule<'static>>,
  dest: &mut Vec<CssRule<'static>>,
) -> Result<(), DiagnosticList> {
  // Each stylesheet is emitted once, at its chosen (last) instance; wrapping an
  // already-emitted stylesheet again would declare empty condition rules.
  if visited[stylesheet_index] {
    return Ok(());
  }
  visited[stylesheet_index] = true;

  let asset_index = stylesheets[stylesheet_index as usize].asset_index;
  let stylesheet = &mut stylesheets[stylesheet_index as usize];
  let loc = stylesheet.loc.clone();
  let asset = &bundle_graph.asset_graph.asset(asset_index);
  let mut rules = std::mem::take(&mut stylesheet.stylesheet.rules.0);

  // Hoist css modules deps
  for (dep_index, dep) in asset.dependencies.iter().enumerate() {
    // Include the dependency if this is the first instance as computed earlier.
    if dep.specifier_type == SpecifierType::Esm {
      if let BundleGraphDependencyResolution::Asset(asset_index) =
        bundle_graph.dependency_resolution(asset_index, dep_index)
      {
        if let Some(dep_source_index) = asset_index_to_stylesheet_index.get(&asset_index) {
          let resolved = &stylesheets[*dep_source_index];
          if resolved.parent_stylesheet_index == stylesheet_index
            && resolved.parent_dep_index == dep_index
          {
            inline(
              bundle_graph,
              bundle,
              get_inline_bundle_content,
              asset_index_to_stylesheet_index,
              stylesheets,
              *dep_source_index,
              visited,
              prefix,
              dest,
            )?;
          }
        }
      }
    }
  }

  let mut dep_index = 0;
  for rule in &mut rules {
    match rule {
      CssRule::Import(import) => {
        let dep = &asset.dependencies[dep_index];
        match bundle_graph.dependency_resolution(asset_index, dep_index) {
          BundleGraphDependencyResolution::Asset(asset_index) => {
            if let Some(dep_source_index) = asset_index_to_stylesheet_index.get(&asset_index) {
              let resolved = &stylesheets[*dep_source_index];

              // Include the dependency if this is the last instance as computed earlier.
              if resolved.parent_stylesheet_index == stylesheet_index
                && resolved.parent_dep_index == dep_index
              {
                inline(
                  bundle_graph,
                  bundle,
                  get_inline_bundle_content,
                  asset_index_to_stylesheet_index,
                  stylesheets,
                  *dep_source_index,
                  visited,
                  prefix,
                  dest,
                )?;
              }
            }

            *rule = CssRule::Ignored;
          }
          BundleGraphDependencyResolution::Bundle { bundle_index, .. } => {
            let referenced_bundle = &bundle_graph.bundles[bundle_index as usize];
            if dep.bundle_behavior == BundleBehavior::Inline
              || referenced_bundle.bundle_behavior == BundleBehavior::Inline
            {
              return Err(
                Diagnostic::from_message(
                  "Inline bundles are not supported in @import.".to_string(),
                )
                .into(),
              );
            } else {
              import.url = referenced_bundle.relative_url(&bundle).unwrap().into();
              // The referenced bundle contains the conditional variant with its
              // rules already wrapped, so drop the conditions from the emitted
              // rule: repeating a layer here would nest the layer path twice.
              import.layer = None;
              import.supports = None;
              import.media = MediaList::new();
            }
            prefix.push(std::mem::replace(rule, CssRule::Ignored));
          }
          _ => {
            prefix.push(std::mem::replace(rule, CssRule::Ignored));
          }
        }

        dep_index += 1;
      }
      CssRule::LayerStatement(_) => {
        // @layer rules are the only rules that may appear before an @import.
        // We must preserve this order to ensure correctness.
        let layer = std::mem::replace(rule, CssRule::Ignored);
        dest.push(layer);
      }
      CssRule::Ignored => {}
      _ => break, // TODO: set rule source index
    }
  }

  let references = if let Some(content) = asset.content.downcast_ref::<CssContent>() {
    content
      .references
      .iter()
      .filter_map(|(k, v)| {
        if let SymbolResolution::Export {
          asset_index,
          export_index,
        } = &asset.symbols.imports[*v].resolved
        {
          let asset = &bundle_graph.asset_graph.asset(*asset_index);
          if let Some(res) = resolve_css_module_export(
            &bundle_graph.asset_graph,
            *asset_index,
            &asset.symbols.exports[*export_index as usize]
              .exported
              .as_str(),
          ) {
            return Some((k.clone(), res));
          }
        }

        None
      })
      .collect()
  } else {
    HashMap::new()
  };

  // Replace URL references.
  let mut replacer = ReferenceReplacer::new(
    bundle_graph,
    asset_index,
    bundle,
    loc,
    references,
    get_inline_bundle_content,
  )?;
  rules.visit(&mut replacer)?;

  // Wrap the variant's rules in its accumulated @layer, @media, and @supports
  // conditions from the target. Nesting composes conditions: nested @media and
  // @supports are conjunctions, and nested @layer blocks concatenate paths.
  if let Some(condition) = &asset.target.style_condition {
    for layer in condition.layers.iter().rev() {
      let name = match layer {
        StyleLayer::Named(name) => Some(
          LayerName::parse_string(name)
            .map_err(|e| Diagnostic::from_message(e.to_string()))?
            .into_owned(),
        ),
        StyleLayer::Anonymous(_) => None,
      };
      rules = vec![CssRule::LayerBlock(LayerBlockRule {
        name,
        rules: CssRuleList(rules),
        loc,
      })]
    }
    for media in &condition.media {
      let mut input = cssparser::ParserInput::new(media);
      let mut parser = cssparser::Parser::new(&mut input);
      let query = MediaList::parse(&mut parser, &ParserOptions::default())
        .map_err(|e| Diagnostic::from_message(e.to_string()))?
        .into_owned();
      rules = vec![CssRule::Media(MediaRule {
        query,
        rules: CssRuleList(rules),
        loc,
      })]
    }
    for supports in &condition.supports {
      rules = vec![CssRule::Supports(SupportsRule {
        condition: SupportsCondition::parse_string(supports)
          .map_err(|e| Diagnostic::from_message(e.to_string()))?
          .into_owned(),
        rules: CssRuleList(rules),
        loc,
      })]
    }
  }

  dest.extend(rules);
  Ok(())
}

struct ReferenceReplacer {
  urls: HashMap<Box<str>, String>,
  css_modules: HashMap<String, String>,
  loc: lightningcss::rules::Location,
}

impl ReferenceReplacer {
  fn new(
    bundle_graph: &BundleGraph,
    asset_index: AssetIndex,
    bundle: &Bundle,
    loc: lightningcss::rules::Location,
    css_modules: HashMap<String, String>,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
  ) -> Result<ReferenceReplacer, DiagnosticList> {
    let mut urls = HashMap::new();
    let dependencies = &bundle_graph.asset_graph.asset(asset_index).dependencies;
    for (dep_index, dep) in dependencies.iter().enumerate() {
      if dep.priority == Priority::Lazy && dep.specifier_type == SpecifierType::Url {
        if let BundleGraphDependencyResolution::Bundle { bundle_index, .. } =
          bundle_graph.dependency_resolution(asset_index, dep_index)
        {
          let referenced_bundle = &bundle_graph.bundles[bundle_index as usize];
          if dep.bundle_behavior == BundleBehavior::Inline
            || referenced_bundle.bundle_behavior == BundleBehavior::Inline
          {
            let url = get_inline_bundle_content(bundle_index as usize)?
              .read_string()?
              .into_owned();
            urls.insert(dep.specifier.clone(), url);
          } else {
            let url = referenced_bundle.relative_url(bundle).unwrap().into();
            urls.insert(dep.specifier.clone(), url);
          }
        }
      }
    }

    Ok(ReferenceReplacer {
      urls,
      css_modules,
      loc,
    })
  }
}

impl<'i> lightningcss::visitor::Visitor<'i> for ReferenceReplacer {
  type Error = Diagnostic;

  fn visit_types(&self) -> lightningcss::visitor::VisitTypes {
    lightningcss::visit_types!(RULES | URLS | DASHED_IDENTS)
  }

  fn visit_rule(&mut self, rule: &mut CssRule<'i>) -> Result<(), Self::Error> {
    match rule {
      CssRule::Media(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::Import(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::Style(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::NestedDeclarations(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::Keyframes(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::FontFace(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::FontPaletteValues(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::FontFeatureValues(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::Page(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::Supports(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::CounterStyle(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::Namespace(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::MozDocument(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::Nesting(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::Viewport(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::CustomMedia(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::LayerStatement(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::LayerBlock(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::Property(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::Container(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::Scope(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::StartingStyle(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::ViewTransition(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::PositionTry(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::Ignored => {}
      CssRule::Unknown(rule) => {
        rule.loc.source_index = self.loc.source_index;
        rule.loc.line += self.loc.line;
      }
      CssRule::Custom(..) => {}
    }

    rule.visit_children(self)
  }

  fn visit_url(&mut self, url: &mut lightningcss::values::url::Url<'i>) -> Result<(), Self::Error> {
    if let Some(replacement) = self.urls.get(&*url.url) {
      url.url = replacement.clone().into();
    }

    Ok(())
  }

  fn visit_dashed_ident(
    &mut self,
    ident: &mut lightningcss::values::ident::DashedIdent,
  ) -> Result<(), Self::Error> {
    if let Some(replacement) = self.css_modules.get(&*ident.0) {
      ident.0 = replacement.clone().into();
    }

    Ok(())
  }
}

impl StyleAttrContent {
  pub(crate) fn package_impl(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    _options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    assert_eq!(bundle.assets.len(), 1);

    let asset = &bundle_graph.asset_graph.asset(bundle.assets[0]);
    let content = asset.content.downcast_ref::<StyleAttrContent>().unwrap();
    let mut decls = content.attr.declarations.clone(); // TODO: avoid clone?
    let mut replacer = ReferenceReplacer::new(
      bundle_graph,
      bundle.assets[0],
      bundle,
      lightningcss::rules::Location {
        source_index: 0,
        line: 0,
        column: 1,
      },
      HashMap::new(),
      get_inline_bundle_content,
    )?;
    if !replacer.urls.is_empty() {
      decls.visit(&mut replacer)?;
    }

    let css = decls.to_css_string(Default::default()).unwrap();
    Ok(Arc::new(BufferContent::new_string(css)))
  }
}
