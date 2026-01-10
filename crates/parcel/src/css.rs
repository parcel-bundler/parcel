use std::{
  collections::{HashMap, HashSet},
  sync::Arc,
};

use lightningcss::{
  css_modules::{CssModuleExport, CssModuleReference},
  media_query::MediaList,
  printer::PrinterOptions,
  rules::{
    CssRule, CssRuleList,
    layer::{LayerBlockRule, LayerName},
    media::MediaRule,
    supports::{SupportsCondition, SupportsRule},
  },
  stylesheet::{MinifyOptions, ParserOptions, StyleAttribute, StyleSheet},
  targets::{Browsers, Targets},
  traits::{IntoOwned, ToCss},
  visitor::Visit,
};
use parcel_core::{
  Asset, AssetNode, BufferContent, Bundle, BundleBehavior, BundleGraph, Content, Dependency,
  DependencyFlags, DependencyResolution, Diagnostic, DiagnosticList, Environment, EnvironmentFlags,
  ImportedSymbol, LocalSymbol, Location, Packager, ParcelOptions, Priority, SourceLocation,
  SourceUrl, SpecifierType, SymbolName, SymbolResolution, Transformer, Version,
};

#[derive(Debug)]
pub struct CssContent {
  // stylesheet: StyleSheet<'static, 'static>,
  rules: CssRuleList<'static>,
  exports: HashMap<String, CssModuleExport>,
  references: HashMap<String, usize>,
}

impl Content for CssContent {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    todo!()
  }
}

pub fn resolve_css_module_export(
  assets: &Vec<AssetNode>,
  asset_index: usize,
  name: &str,
) -> Option<String> {
  let AssetNode::Asset(asset) = &assets[asset_index] else {
    return None;
  };

  let Some(content) = asset.content.downcast_ref::<CssContent>() else {
    return None;
  };

  if let Some(export) = content.exports.get(name) {
    let mut res = export.name.clone();
    for composes in &export.composes {
      res.push(' ');
      match composes {
        CssModuleReference::Global { name } => {
          res.push_str(name);
        }
        CssModuleReference::Local { name } => {
          if let Some(resolved) = resolve_css_module_export(assets, asset_index, name) {
            res.push_str(&resolved);
          }
        }
        CssModuleReference::Dependency { name, specifier } => {
          if let Some(dep) = asset
            .dependencies
            .iter()
            .find(|d| d.specifier == *specifier && d.specifier_type == SpecifierType::Esm)
          {
            if let DependencyResolution::Asset(resolved) = dep.resolution {
              if let Some(resolved) = resolve_css_module_export(assets, resolved as usize, name) {
                res.push_str(&resolved);
              }
            }
          }
        }
      }
    }

    return Some(res);
  }

  None
}

pub struct CssTransformer {
  pub css_modules: Option<lightningcss::css_modules::Config<'static>>,
}

impl Transformer for CssTransformer {
  fn transform(&self, mut asset: Asset, _options: &ParcelOptions) -> Result<Asset, DiagnosticList> {
    // TODO: normalize environment

    let code = asset.content.read()?;
    let code = std::str::from_utf8(&code)?;
    let mut stylesheet = StyleSheet::parse(
      code,
      ParserOptions {
        filename: asset.loc.url.to_string(),
        css_modules: self.css_modules.clone(),
        ..Default::default()
      },
    )
    .unwrap();

    stylesheet
      .minify(MinifyOptions {
        targets: Targets {
          browsers: if asset.env.context.is_browser() {
            let browsers = &asset.env.engines.browsers;
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
        ..Default::default()
      })
      .unwrap();

    let mut collector = DependencyCollector {
      dependencies: &mut asset.dependencies,
      env: asset.env.clone(),
      url: asset.loc.url.clone(),
    };
    stylesheet.visit(&mut collector).unwrap();

    if self.css_modules.is_some() {
      // TODO: transform AST instead of printing and re-parsing.
      let res = stylesheet.to_css(Default::default()).unwrap();
      let exports = res.exports.clone().unwrap_or(HashMap::new());
      let mut refs = HashMap::new();
      if let Some(exports) = res.exports {
        for (name, exp) in exports {
          asset.symbols.exports.push(LocalSymbol {
            exported: SymbolName::from(name),
            requested: exp.is_referenced,
          });

          for composes in exp.composes {
            if let CssModuleReference::Dependency { name, specifier } = composes {
              let dep_index = asset.dependencies.len() as u32;
              asset.dependencies.push(Dependency {
                specifier,
                specifier_type: SpecifierType::Esm,
                priority: Priority::Sync,
                bundle_behavior: BundleBehavior::None,
                flags: DependencyFlags::empty(),
                env: asset.env.clone(),
                loc: None,
                placeholder: None,
                resolve_from: Some(asset.loc.url.clone()),
                range: None,
                resolution: DependencyResolution::None,
              });

              asset.symbols.imports.push(ImportedSymbol {
                dep_index,
                symbol: SymbolName::from(name),
                resolved: parcel_core::SymbolResolution::None,
              });
            }
          }
        }
      }

      if let Some(references) = res.references {
        for (placeholder, reference) in references {
          match reference {
            CssModuleReference::Local { name } => {
              // mark as used
            }
            CssModuleReference::Global { name } => {}
            CssModuleReference::Dependency { name, specifier } => {
              let dep_index = asset.dependencies.len() as u32;
              asset.dependencies.push(Dependency {
                specifier,
                specifier_type: SpecifierType::Esm,
                priority: Priority::Sync,
                bundle_behavior: BundleBehavior::None,
                flags: DependencyFlags::empty(),
                env: asset.env.clone(),
                loc: None,
                placeholder: None,
                resolve_from: Some(asset.loc.url.clone()),
                range: None,
                resolution: DependencyResolution::None,
              });

              let index = asset.symbols.imports.len();
              refs.insert(placeholder, index);
              asset.symbols.imports.push(ImportedSymbol {
                dep_index,
                symbol: SymbolName::from(name),
                resolved: parcel_core::SymbolResolution::None,
              });
            }
          }
        }
      }

      let stylesheet = StyleSheet::parse(
        &res.code,
        ParserOptions {
          filename: asset.loc.url.to_string(),
          ..Default::default()
        },
      )
      .unwrap();

      asset.content = Arc::new(CssContent {
        rules: stylesheet.rules.into_owned(),
        exports,
        references: refs,
      });
    } else {
      asset.content = Arc::new(CssContent {
        rules: stylesheet.rules.into_owned(),
        exports: HashMap::new(),
        references: HashMap::new(),
      });
    }

    Ok(asset)
  }
}

struct DependencyCollector<'a> {
  dependencies: &'a mut Vec<Dependency>,
  env: Arc<Environment>,
  url: SourceUrl,
}

impl<'i, 'a> lightningcss::visitor::Visitor<'i> for DependencyCollector<'a> {
  type Error = ();

  fn visit_types(&self) -> lightningcss::visitor::VisitTypes {
    lightningcss::visit_types!(RULES | URLS)
  }

  fn visit_rule(&mut self, rule: &mut lightningcss::rules::CssRule<'i>) -> Result<(), Self::Error> {
    if let CssRule::Import(import) = rule {
      self.dependencies.push(Dependency {
        specifier: import.url.to_string(),
        specifier_type: SpecifierType::Url,
        priority: Priority::Sync,
        bundle_behavior: BundleBehavior::None,
        flags: DependencyFlags::empty(),
        env: self.env.clone(),
        loc: Some(SourceLocation {
          url: self.url.clone(),
          start: Location {
            line: import.loc.line,
            column: import.loc.column,
          },
          end: Location {
            line: import.loc.line,
            column: import.loc.column,
          },
        }),
        placeholder: None,
        resolve_from: Some(self.url.clone()),
        range: None,
        resolution: DependencyResolution::None,
      });

      Ok(())
    } else {
      rule.visit_children(self)
    }
  }

  fn visit_url(&mut self, url: &mut lightningcss::values::url::Url<'i>) -> Result<(), Self::Error> {
    self.dependencies.push(Dependency {
      specifier: url.url.to_string(),
      specifier_type: SpecifierType::Url,
      priority: Priority::Lazy,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::empty(),
      env: self.env.clone(),
      loc: Some(SourceLocation {
        url: self.url.clone(),
        start: Location {
          line: url.loc.line,
          column: url.loc.column,
        },
        end: Location {
          line: url.loc.line,
          column: url.loc.column,
        },
      }),
      placeholder: None,
      resolve_from: Some(self.url.clone()),
      range: None,
      resolution: DependencyResolution::None,
    });

    Ok(())
  }
}

fn convert_version(c: Version) -> u32 {
  ((c.major() as u32) << 16) | ((c.minor() as u32) << 8)
}

struct StyleSheetWrapper {
  asset_index: usize,
  stylesheet: StyleSheet<'static, 'static>,
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
  loc: lightningcss::rules::Location,
}

pub struct CssPackager {}

impl Packager for CssPackager {
  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    _get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    let mut asset_index_to_stylesheet_index: HashMap<u32, usize> = HashMap::new();
    let mut stylesheets = Vec::new();
    for asset_index in &bundle.assets {
      let asset = bundle_graph.asset_graph.assets[*asset_index].expect_asset();
      if let Some(content) = asset.content.downcast_ref::<CssContent>() {
        asset_index_to_stylesheet_index.insert(*asset_index as u32, stylesheets.len());
        stylesheets.push(StyleSheetWrapper {
          asset_index: *asset_index,
          stylesheet: StyleSheet::new(
            vec![asset.loc.url.to_string()],
            content.rules.clone(),
            Default::default(),
          ),
          layer: None,
          supports: None,
          media: MediaList::new(),
          parent_stylesheet_index: 0,
          parent_dep_index: 0,
          loc: lightningcss::rules::Location {
            source_index: 0,
            line: 0,
            column: 0,
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
          &bundle_graph.asset_graph.assets,
          &asset_index_to_stylesheet_index,
          &mut stylesheets,
          State {
            stylesheet_index: index,
            parent_stylesheet_index: 0,
            dep_index: 0,
            layer: None,
            supports: None,
            media: MediaList::new(),
            loc: lightningcss::rules::Location {
              source_index: index as u32,
              line: 0,
              column: 0,
            },
          },
          &mut visited,
        );
      }
    }

    let mut dest = Vec::new();
    let mut visited = vec![false; stylesheets.len()];
    for source_index in 0..stylesheets.len() {
      if !visited[source_index] {
        inline(
          &bundle_graph,
          &asset_index_to_stylesheet_index,
          &mut stylesheets,
          source_index,
          &mut visited,
          &mut dest,
        );
      }
    }

    let stylesheet = StyleSheet::new(
      stylesheets
        .into_iter()
        .flat_map(|s| s.stylesheet.sources)
        .collect(),
      CssRuleList(dest),
      ParserOptions {
        ..Default::default()
      },
    );

    let res = stylesheet
      .to_css(PrinterOptions {
        minify: bundle.env.flags.contains(EnvironmentFlags::SHOULD_OPTIMIZE),
        ..Default::default()
      })
      .unwrap();
    let content = Arc::new(BufferContent::new(res.code.into_bytes()));
    Ok(content)
  }
}

fn collect(
  assets: &Vec<AssetNode>,
  asset_index_to_stylesheet_index: &HashMap<u32, usize>,
  stylesheets: &mut Vec<StyleSheetWrapper>,
  state: State,
  visited: &mut Vec<bool>,
) {
  let stylesheet = &mut stylesheets[state.stylesheet_index];

  // In browsers, every instance of an @import is evaluated, so we preserve the last.
  stylesheet.parent_stylesheet_index = state.parent_stylesheet_index;
  stylesheet.parent_dep_index = state.dep_index;
  stylesheet.loc = state.loc;

  // We cannot combine a media query and a supports query from different @import rules.
  // e.g. @import "a.css" print; @import "a.css" supports(color: red);
  // This would require duplicating the actual rules in the file.
  if (!state.media.media_queries.is_empty() && !stylesheet.supports.is_none())
    || (!stylesheet.media.media_queries.is_empty() && !state.supports.is_none())
  {
    // return Err(Error {
    //   kind: BundleErrorKind::UnsupportedImportCondition,
    //   loc: Some(ErrorLocation::new(rule.loc, self.find_filename(rule.loc.source_index))),
    // });
    todo!()
  }

  if state.media.media_queries.is_empty() {
    stylesheet.media.media_queries.clear();
  } else if !stylesheet.media.media_queries.is_empty() {
    stylesheet.media.or(&state.media);
  }

  if let Some(supports) = &state.supports {
    if let Some(existing_supports) = &mut stylesheet.supports {
      existing_supports.or(&supports)
    }
  } else {
    stylesheet.supports = None;
  }

  if let Some(layer) = &state.layer {
    if let Some(existing_layer) = &stylesheet.layer {
      // We can't OR layer names without duplicating all of the nested rules, so error for now.
      if layer != existing_layer || (layer.is_none() && existing_layer.is_none()) {
        // return Err(Error {
        //   kind: BundleErrorKind::UnsupportedLayerCombination,
        //   loc: Some(ErrorLocation::new(rule.loc, self.find_filename(rule.loc.source_index))),
        // });
        todo!()
      }
    } else {
      stylesheet.layer = state.layer.clone();
    }
  }

  if visited[state.stylesheet_index] {
    return;
  }

  visited[state.stylesheet_index] = true;

  let asset = assets[stylesheet.asset_index].expect_asset();
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
      .unwrap();
  }

  let mut dep_index = 0;
  for rule in &content.rules.0 {
    match &rule {
      CssRule::Import(import) => {
        let dep = &asset.dependencies[dep_index];
        if let DependencyResolution::Asset(asset_index) = dep.resolution {
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
            assets,
            asset_index_to_stylesheet_index,
            stylesheets,
            State {
              parent_stylesheet_index: state.stylesheet_index,
              stylesheet_index: asset_index_to_stylesheet_index[&asset_index],
              dep_index,
              layer,
              supports: combine_supports(state.supports.clone(), &import.supports),
              media,
              loc: import.loc.clone(),
            },
            visited,
          );
        }
        dep_index += 1;
      }
      CssRule::LayerStatement(_) => continue,
      _ => break,
    }
  }
}

fn inline(
  bundle_graph: &BundleGraph,
  asset_index_to_stylesheet_index: &HashMap<u32, usize>,
  stylesheets: &mut Vec<StyleSheetWrapper>,
  source_index: usize,
  visited: &mut Vec<bool>,
  dest: &mut Vec<CssRule<'static>>,
) {
  let stylesheet = &mut stylesheets[source_index as usize];
  let asset = bundle_graph.asset_graph.assets[stylesheet.asset_index].expect_asset();
  let mut rules = std::mem::take(&mut stylesheet.stylesheet.rules.0);

  // Hoist css modules deps
  for (dep_index, dep) in asset.dependencies.iter().enumerate() {
    // Include the dependency if this is the first instance as computed earlier.
    if dep.specifier_type == SpecifierType::Esm {
      if let DependencyResolution::Asset(asset_index) = dep.resolution {
        let dep_source_index = asset_index_to_stylesheet_index[&asset_index];
        let resolved = &stylesheets[dep_source_index];
        if resolved.parent_stylesheet_index == source_index
          && resolved.parent_dep_index == dep_index
        {
          inline(
            bundle_graph,
            asset_index_to_stylesheet_index,
            stylesheets,
            dep_source_index,
            visited,
            dest,
          );
        }
      }
    }
  }

  let mut dep_index = 0;
  for rule in &mut rules {
    match rule {
      CssRule::Import(import) => {
        let dep = &asset.dependencies[dep_index];
        match dep.resolution {
          DependencyResolution::Asset(asset_index) => {
            let dep_source_index = asset_index_to_stylesheet_index[&asset_index];
            let resolved = &stylesheets[dep_source_index];

            // Include the dependency if this is the last instance as computed earlier.
            if resolved.parent_stylesheet_index == source_index
              && resolved.parent_dep_index == dep_index
            {
              inline(
                bundle_graph,
                asset_index_to_stylesheet_index,
                stylesheets,
                dep_source_index,
                visited,
                dest,
              );
            }

            *rule = CssRule::Ignored;
          }
          DependencyResolution::Bundle(bundle_index) => {
            let bundle = &bundle_graph.bundles[bundle_index as usize];
            if dep.bundle_behavior == BundleBehavior::Inline
              || bundle.bundle_behavior == BundleBehavior::Inline
            {
              todo!()
            } else {
              let url = bundle.name.as_ref().unwrap().to_str().unwrap().to_owned(); // TODO
              import.url = url.into();
            }
          }
          _ => break,
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
          if let AssetNode::Asset(asset) = &bundle_graph.asset_graph.assets[*asset_index as usize] {
            if let Some(res) = resolve_css_module_export(
              &bundle_graph.asset_graph.assets,
              *asset_index as usize,
              &asset.symbols.exports[*export_index as usize]
                .exported
                .as_str(),
            ) {
              return Some((k.clone(), res));
            }
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
    &asset.dependencies,
    &bundle_graph.bundles,
    source_index as u32,
    references,
  );
  rules.visit(&mut replacer).unwrap();

  // Wrap rules in the appropriate @layer, @media, and @supports rules.
  let stylesheet = &mut stylesheets[source_index as usize];

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
  source_index: u32,
}

impl ReferenceReplacer {
  fn new(
    dependencies: &Vec<Dependency>,
    bundles: &Vec<Bundle>,
    source_index: u32,
    css_modules: HashMap<String, String>,
  ) -> ReferenceReplacer {
    let mut urls = HashMap::new();
    for dep in dependencies {
      if dep.priority == Priority::Lazy && dep.specifier_type == SpecifierType::Url {
        if let DependencyResolution::Bundle(bundle_index) = dep.resolution {
          let bundle = &bundles[bundle_index as usize];
          if dep.bundle_behavior == BundleBehavior::Inline
            || bundle.bundle_behavior == BundleBehavior::Inline
          {
            todo!()
          } else {
            let url = bundle.name.as_ref().unwrap().to_str().unwrap().to_owned(); // TODO
            urls.insert(dep.specifier.clone(), url);
          }
        }
      }
    }

    ReferenceReplacer {
      urls,
      css_modules,
      source_index,
    }
  }
}

impl<'i> lightningcss::visitor::Visitor<'i> for ReferenceReplacer {
  type Error = ();

  fn visit_types(&self) -> lightningcss::visitor::VisitTypes {
    lightningcss::visit_types!(RULES | URLS | DASHED_IDENTS)
  }

  fn visit_rule(&mut self, rule: &mut CssRule<'i>) -> Result<(), Self::Error> {
    match rule {
      CssRule::Media(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::Import(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::Style(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::Keyframes(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::FontFace(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::FontPaletteValues(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::FontFeatureValues(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::Page(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::Supports(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::CounterStyle(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::Namespace(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::MozDocument(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::Nesting(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::Viewport(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::CustomMedia(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::LayerStatement(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::LayerBlock(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::Property(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::Container(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::Scope(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::StartingStyle(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::ViewTransition(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::Ignored => {}
      CssRule::Unknown(rule) => {
        rule.loc.source_index = self.source_index;
      }
      CssRule::Custom(rule) => {}
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

struct StyleAttrContent {
  attr: StyleAttribute<'static>,
}

impl std::fmt::Debug for StyleAttrContent {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "todo")
  }
}

impl Content for StyleAttrContent {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    todo!()
  }
}

pub struct StyleAttrTransformer {}

impl Transformer for StyleAttrTransformer {
  fn transform(&self, mut asset: Asset, _options: &ParcelOptions) -> Result<Asset, DiagnosticList> {
    let code = asset.content.read()?;
    let code = std::str::from_utf8(&code)?;
    let mut attr = StyleAttribute::parse(
      code,
      ParserOptions {
        filename: asset.loc.url.to_string(),
        ..Default::default()
      },
    )
    .unwrap();

    attr.minify(MinifyOptions {
      targets: Targets {
        browsers: if asset.env.context.is_browser() {
          let browsers = &asset.env.engines.browsers;
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
      ..Default::default()
    });

    attr
      .visit(&mut DependencyCollector {
        dependencies: &mut asset.dependencies,
        env: asset.env.clone(),
        url: asset.loc.url.clone(),
      })
      .unwrap();

    asset.content = Arc::new(StyleAttrContent {
      attr: attr.into_owned(),
    });
    Ok(asset)
  }
}

pub struct StyleAttrPackager {}

impl Packager for StyleAttrPackager {
  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    _get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    assert_eq!(bundle.assets.len(), 1);

    let asset = bundle_graph.asset_graph.assets[bundle.assets[0]].expect_asset();
    let content = asset.content.downcast_ref::<StyleAttrContent>().unwrap();
    let mut decls = content.attr.declarations.clone(); // TODO: avoid clone?
    let mut replacer = ReferenceReplacer::new(
      &asset.dependencies,
      &bundle_graph.bundles,
      0,
      HashMap::new(),
    );
    if !replacer.urls.is_empty() {
      decls.visit(&mut replacer).unwrap();
    }

    let css = decls.to_css_string(Default::default()).unwrap();
    Ok(Arc::new(BufferContent::new(css.into_bytes())))
  }
}
