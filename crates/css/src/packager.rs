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
  traits::ToCss,
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
  layer: Option<Option<LayerName<'static>>>,
  supports: Option<SupportsCondition<'static>>,
  media: MediaList<'static>,
  loc: lightningcss::rules::Location,
  parent_stylesheet_index: usize,
  parent_dep_index: usize,
}

struct State {
  parent_stylesheet_index: usize,
  stylesheet_index: usize,
  dep_index: usize,
  layer: Option<Option<LayerName<'static>>>,
  supports: Option<SupportsCondition<'static>>,
  media: MediaList<'static>,
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
          layer: None,
          supports: None,
          media: MediaList::new(),
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
          State {
            stylesheet_index: index,
            parent_stylesheet_index: 0,
            dep_index: 0,
            layer: None,
            supports: None,
            media: MediaList::new(),
          },
          &mut visited,
        )?;
      }
    }

    let mut dest = Vec::new();
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
          &mut dest,
        )?;
      }
    }

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
      Ok(Arc::new(ContentWithSourceMap::new(
        res.code.into_bytes(),
        map.into_bytes(),
      )))
    } else {
      Ok(Arc::new(BufferContent::new(res.code.into_bytes())))
    }
  }
}

fn collect(
  bundle_graph: &BundleGraph,
  asset_index_to_stylesheet_index: &HashMap<AssetIndex, usize>,
  stylesheets: &mut Vec<StyleSheetWrapper>,
  state: State,
  visited: &mut Vec<bool>,
) -> Result<(), DiagnosticList> {
  let stylesheet = &mut stylesheets[state.stylesheet_index];

  // In browsers, every instance of an @import is evaluated, so we preserve the last.
  stylesheet.parent_stylesheet_index = state.parent_stylesheet_index;
  stylesheet.parent_dep_index = state.dep_index;

  // We cannot combine a media query and a supports query from different @import rules.
  // e.g. @import "a.css" print; @import "a.css" supports(color: red);
  // This would require duplicating the actual rules in the file.
  if (!state.media.media_queries.is_empty() && !stylesheet.supports.is_none())
    || (!stylesheet.media.media_queries.is_empty() && !state.supports.is_none())
  {
    return Err(Diagnostic::from_message(
      "Cannot combine a media query and a supports condition from different @import rules of the same file.".to_string(),
    ).into());
  }

  if state.media.media_queries.is_empty() {
    stylesheet.media.media_queries.clear();
  } else if !stylesheet.media.media_queries.is_empty() {
    stylesheet.media.or(&state.media);
  } else {
    stylesheet.media = state.media.clone();
  }

  if let Some(supports) = &state.supports {
    if let Some(existing_supports) = &mut stylesheet.supports {
      existing_supports.or(&supports)
    } else {
      stylesheet.supports = Some(supports.clone());
    }
  } else {
    stylesheet.supports = None;
  }

  if let Some(layer) = &state.layer {
    if let Some(existing_layer) = &stylesheet.layer {
      // We can't OR layer names without duplicating all of the nested rules, so error for now.
      if layer != existing_layer || (layer.is_none() && existing_layer.is_none()) {
        return Err(
          Diagnostic::from_message(
            "Cannot combine multiple @layer rules for the same imported file.".to_string(),
          )
          .into(),
        );
      }
    } else {
      stylesheet.layer = state.layer.clone();
    }
  }

  if visited[state.stylesheet_index] {
    return Ok(());
  }

  visited[state.stylesheet_index] = true;

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
      CssRule::Import(import) => {
        if let BundleGraphDependencyResolution::Asset(asset_index) =
          bundle_graph.dependency_resolution(asset_index, dep_index)
        {
          if let Some(stylesheet_index) = asset_index_to_stylesheet_index.get(&asset_index) {
            let layer = if (state.layer == Some(None) && import.layer.is_some())
              || (import.layer == Some(None) && state.layer.is_some())
            {
              // Cannot combine anonymous layers
              unreachable!();
            } else if let Some(Some(a)) = &state.layer {
              if let Some(Some(b)) = &import.layer {
                let mut name = a.clone();
                name.0.extend(b.0.iter().cloned());
                Some(Some(name))
              } else {
                Some(Some(a.clone()))
              }
            } else {
              import.layer.clone()
            };

            let mut media = state.media.clone();
            media.and(&import.media).unwrap();

            collect(
              bundle_graph,
              asset_index_to_stylesheet_index,
              stylesheets,
              State {
                parent_stylesheet_index: state.stylesheet_index,
                stylesheet_index: *stylesheet_index,
                dep_index,
                layer,
                supports: combine_supports(state.supports.clone(), &import.supports),
                media,
              },
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
  dest: &mut Vec<CssRule<'static>>,
) -> Result<(), DiagnosticList> {
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
              dest,
            )?;
          }
        }
      }
    }
  }

  let mut dep_index = 0;
  let mut has_bundled_import = false;
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
                  dest,
                )?;
              }
            }

            *rule = CssRule::Ignored;
            has_bundled_import = true;
          }
          BundleGraphDependencyResolution::Bundle(bundle_index) => {
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
            }
            dest.push(std::mem::replace(rule, CssRule::Ignored));
          }
          _ => {
            if has_bundled_import {
              return Err(
                Diagnostic::from_message(
                  "External @import rules must appear before bundled @import rules.".to_string(),
                )
                .into(),
              );
            }
            dest.push(std::mem::replace(rule, CssRule::Ignored));
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

  // Wrap rules in the appropriate @layer, @media, and @supports rules.
  let stylesheet = &mut stylesheets[stylesheet_index as usize];

  if stylesheet.layer.is_some() {
    rules = vec![CssRule::LayerBlock(LayerBlockRule {
      name: stylesheet.layer.take().unwrap(),
      rules: CssRuleList(rules),
      loc: stylesheet.loc,
    })]
  }

  if !stylesheet.media.media_queries.is_empty() {
    rules = vec![CssRule::Media(MediaRule {
      query: std::mem::replace(&mut stylesheet.media, MediaList::new()),
      rules: CssRuleList(rules),
      loc: stylesheet.loc,
    })]
  }

  if stylesheet.supports.is_some() {
    rules = vec![CssRule::Supports(SupportsRule {
      condition: stylesheet.supports.take().unwrap(),
      rules: CssRuleList(rules),
      loc: stylesheet.loc,
    })]
  }

  dest.extend(rules);
  Ok(())
}

fn combine_supports<'a>(
  a: Option<SupportsCondition<'a>>,
  b: &Option<SupportsCondition<'a>>,
) -> Option<SupportsCondition<'a>> {
  if let Some(mut a) = a {
    if let Some(b) = b {
      a.and(b)
    }
    Some(a)
  } else {
    b.clone()
  }
}

struct ReferenceReplacer {
  urls: HashMap<String, String>,
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
        if let BundleGraphDependencyResolution::Bundle(bundle_index) =
          bundle_graph.dependency_resolution(asset_index, dep_index)
        {
          let referenced_bundle = &bundle_graph.bundles[bundle_index as usize];
          if dep.bundle_behavior == BundleBehavior::Inline
            || referenced_bundle.bundle_behavior == BundleBehavior::Inline
          {
            let url = String::from_utf8(get_inline_bundle_content(bundle_index as usize)?.read()?)?;
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
    Ok(Arc::new(BufferContent::new(css.into_bytes())))
  }
}
