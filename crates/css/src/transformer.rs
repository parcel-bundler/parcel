use std::{collections::HashMap, sync::Arc};

use lightningcss::{
  css_modules::CssModuleReference,
  printer::PrinterOptions,
  rules::CssRule,
  stylesheet::{MinifyOptions, ParserOptions, StyleAttribute, StyleSheet},
  targets::{Browsers, Targets},
  traits::{IntoOwned, ToCss},
  visitor::Visit,
};
use parcel_core::*;

use crate::{CssContent, StyleAttrContent, convert_error, convert_version};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
  css_modules: Option<CssModulesOption>,
  pseudo_classes: Option<PseudoClasses>,
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum CssModulesOption {
  Bool(bool),
  Config(CssModulesConfig),
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CssModulesConfig {
  pattern: Option<String>,
  dashed_idents: Option<bool>,
  animation: Option<bool>,
  container: Option<bool>,
  grid: Option<bool>,
  custom_idents: Option<bool>,
  pure: Option<bool>,
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PseudoClasses {
  pub hover: Option<String>,
  pub active: Option<String>,
  pub focus: Option<String>,
  pub focus_visible: Option<String>,
  pub focus_within: Option<String>,
}

#[derive(Default)]
pub struct CssTransformer {
  pub css_modules: Option<lightningcss::css_modules::Config>,
  pub pseudo_classes: Option<Arc<PseudoClasses>>,
}

impl<'de> serde::Deserialize<'de> for CssTransformer {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let config: Config = serde::Deserialize::deserialize(deserializer)?;
    Ok(CssTransformer {
      css_modules: if let Some(css_modules) = config.css_modules {
        match css_modules {
          CssModulesOption::Bool(true) => Some(lightningcss::css_modules::Config::default()),
          CssModulesOption::Bool(false) => None,
          CssModulesOption::Config(c) => Some(lightningcss::css_modules::Config {
            pattern: if let Some(pattern) = c.pattern {
              match lightningcss::css_modules::Pattern::parse(pattern.leak()) {
                Ok(p) => p,
                Err(e) => return Err(serde::de::Error::custom(e.to_string())),
              }
            } else {
              Default::default()
            },
            dashed_idents: c.dashed_idents.unwrap_or_default(),
            animation: c.animation.unwrap_or(true),
            container: c.container.unwrap_or(true),
            grid: c.grid.unwrap_or(true),
            custom_idents: c.custom_idents.unwrap_or(true),
            pure: c.pure.unwrap_or_default(),
          }),
        }
      } else {
        None
      },
      pseudo_classes: config.pseudo_classes.map(Arc::new),
    })
  }
}

impl Transformer for CssTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    options: &ParcelOptions,
    _fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  ) -> Result<Asset, DiagnosticList> {
    let code = asset.content.read()?;
    let code = std::str::from_utf8(&code)?;
    let mut stylesheet = StyleSheet::parse(
      code,
      ParserOptions {
        filename: asset.loc.url.stable_id(&options.project_root),
        css_modules: self.css_modules.clone(),
        ..Default::default()
      },
    )
    .map_err(|err| convert_error(Some(asset.loc.url.clone()), err))?;

    stylesheet
      .minify(MinifyOptions {
        targets: Targets {
          browsers: if asset.target.environment.is_browser() {
            let browsers = &asset.target.engines.browsers;
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
      .map_err(|err| convert_error(Some(asset.loc.url.clone()), err))?;

    let unconditional_target = unconditional(&asset.target);
    let mut collector = DependencyCollector {
      dependencies: &mut asset.dependencies,
      target: asset.target.clone(),
      unconditional_target: unconditional_target.clone(),
      import_index: 0,
      url: asset.loc.url.clone(),
      project_root: options.project_root.clone(),
      in_custom_property: false,
    };
    stylesheet.visit(&mut collector)?;

    if self.css_modules.is_some() && asset.loc.start.line == 0 {
      // TODO: transform AST instead of printing and re-parsing.
      let res = stylesheet
        .to_css(PrinterOptions {
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
        .map_err(|err| convert_error(Some(asset.loc.url.clone()), err))?;
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
                specifier: specifier.into_boxed_str(),
                specifier_type: SpecifierType::Esm,
                priority: Priority::Sync,
                bundle_behavior: BundleBehavior::None,
                import_type: ImportType::JavaScript,
                flags: DependencyFlags::empty(),
                target: unconditional_target.clone(),
                loc: None,
                placeholder: None,
                resolve_from: Some(asset.loc.url.clone()),
                range: None,
                conditions: ExportsCondition::STYLE,
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
            CssModuleReference::Local { .. } => {
              // mark as used
            }
            CssModuleReference::Global { .. } => {}
            CssModuleReference::Dependency { name, specifier } => {
              let dep_index = asset.dependencies.len() as u32;
              asset.dependencies.push(Dependency {
                specifier: specifier.into_boxed_str(),
                specifier_type: SpecifierType::Esm,
                priority: Priority::Sync,
                bundle_behavior: BundleBehavior::None,
                import_type: ImportType::JavaScript,
                flags: DependencyFlags::empty(),
                target: unconditional_target.clone(),
                loc: None,
                placeholder: None,
                resolve_from: Some(asset.loc.url.clone()),
                range: None,
                conditions: ExportsCondition::STYLE,
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
          filename: asset.loc.url.stable_id(&options.project_root),
          ..Default::default()
        },
      )
      .map_err(|err| convert_error(Some(asset.loc.url.clone()), err))?;

      asset.content = Arc::new(CssContent {
        source_size: code.len(),
        stylesheet: stylesheet.into_owned(),
        exports,
        references: refs,
        pseudo_classes: None,
      });
    } else {
      asset.content = Arc::new(CssContent {
        source_size: code.len(),
        stylesheet: stylesheet.into_owned(),
        exports: HashMap::new(),
        references: HashMap::new(),
        pseudo_classes: self.pseudo_classes.clone(),
      });
    }

    Ok(asset)
  }
}

/// The importing asset's target without any style condition, for dependencies
/// on other asset types: conditions only apply along the stylesheet `@import`
/// chain, and `Target::normalize` strips them from other types as a backstop.
fn unconditional(target: &Arc<Target>) -> Arc<Target> {
  if target.style_condition.is_some() {
    Arc::new(Target {
      style_condition: None,
      ..(**target).clone()
    })
  } else {
    target.clone()
  }
}

struct DependencyCollector<'a> {
  dependencies: &'a mut Vec<Dependency>,
  target: Arc<Target>,
  unconditional_target: Arc<Target>,
  import_index: usize,
  url: SourceUrl,
  project_root: PathId,
  in_custom_property: bool,
}

impl<'a> DependencyCollector<'a> {
  /// The target for an `@import` dependency: the importer's target with the
  /// import rule's layer, media, and supports conditions composed onto the
  /// accumulated style condition. Each distinct accumulated condition makes
  /// the imported stylesheet a separate asset.
  fn import_target(
    &mut self,
    import: &lightningcss::rules::import::ImportRule,
  ) -> Result<Arc<Target>, Diagnostic> {
    let index = self.import_index;
    self.import_index += 1;
    // A stylesheet importing itself is a cycle browsers ignore. Composing a
    // condition would mint a new variant per traversal and never terminate,
    // so keep the current target: the request collapses back to this asset.
    let relative = !import.url.contains(':') && !import.url.starts_with("//");
    if relative && self.url.join(&import.url) == self.url {
      return Ok(self.target.clone());
    }
    // Indirect layered import cycles also grow the condition without bound
    // (each pass appends another layer), but the files differ so they cannot
    // be recognized locally. No real nesting approaches this depth.
    if self
      .target
      .style_condition
      .as_ref()
      .is_some_and(|condition| condition.layers.len() >= 32)
    {
      return Err(Diagnostic::from_message(format!(
        "Detected an import cycle through layered @import rules involving {}.",
        self.url
      )));
    }
    let print = |css: &dyn Fn() -> Result<String, lightningcss::error::PrinterError>| {
      css().map_err(|err| Diagnostic::from_message(err.to_string()))
    };
    let minify = || PrinterOptions {
      minify: true,
      ..Default::default()
    };
    let media = if import.media.media_queries.is_empty() {
      None
    } else {
      Some(print(&|| import.media.to_css_string(minify()))?)
    };
    let supports = match &import.supports {
      Some(supports) => Some(print(&|| supports.to_css_string(minify()))?),
      None => None,
    };
    let layer = match &import.layer {
      None => None,
      // Every anonymous `layer` import site declares a distinct layer. Mint a
      // stable generated name so all assets inheriting this site share one
      // layer in the output, even across bundles; a fresh anonymous block per
      // asset would create several distinct layers.
      Some(None) => {
        let site = xxhash_rust::xxh3::xxh3_64(
          format!("{}:{}", self.url.stable_id(&self.project_root), index).as_bytes(),
        );
        Some(StyleLayer::Anonymous(
          format!("-p-{site:016x}").into_boxed_str(),
        ))
      }
      Some(Some(name)) => Some(StyleLayer::Named(
        print(&|| name.to_css_string(minify()))?.into_boxed_str(),
      )),
    };
    if media.is_none() && supports.is_none() && layer.is_none() {
      return Ok(self.target.clone());
    }
    let mut condition = self
      .target
      .style_condition
      .as_deref()
      .cloned()
      .unwrap_or_default();
    if let Some(layer) = layer {
      condition.layers.push(layer);
    }
    for (value, list) in [
      (media, &mut condition.media),
      (supports, &mut condition.supports),
    ] {
      if let Some(value) = value {
        let value = value.into_boxed_str();
        if !list.contains(&value) {
          list.push(value);
          list.sort();
        }
      }
    }
    Ok(Arc::new(Target {
      style_condition: Some(Arc::new(condition)),
      ..(*self.target).clone()
    }))
  }
}

impl<'i, 'a> lightningcss::visitor::Visitor<'i> for DependencyCollector<'a> {
  type Error = Diagnostic;

  fn visit_types(&self) -> lightningcss::visitor::VisitTypes {
    lightningcss::visit_types!(RULES | PROPERTIES | URLS)
  }

  fn visit_rule(&mut self, rule: &mut lightningcss::rules::CssRule<'i>) -> Result<(), Self::Error> {
    if let CssRule::Import(import) = rule {
      let target = self.import_target(import)?;
      self.dependencies.push(Dependency {
        specifier: import.url.to_string().into_boxed_str(),
        specifier_type: SpecifierType::Url,
        priority: Priority::Sync,
        bundle_behavior: BundleBehavior::None,
        import_type: ImportType::StyleSheet,
        flags: DependencyFlags::empty(),
        target,
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
        conditions: ExportsCondition::STYLE,
        resolution: DependencyResolution::None,
      });

      Ok(())
    } else {
      rule.visit_children(self)
    }
  }

  fn visit_property(
    &mut self,
    property: &mut lightningcss::properties::Property<'i>,
  ) -> Result<(), Self::Error> {
    if matches!(property, lightningcss::properties::Property::Custom(_)) {
      self.in_custom_property = true;
      property.visit_children(self)?;
      self.in_custom_property = false;
      Ok(())
    } else {
      property.visit_children(self)
    }
  }

  fn visit_url(&mut self, url: &mut lightningcss::values::url::Url<'i>) -> Result<(), Self::Error> {
    if self.in_custom_property && !url.is_absolute() {
      return Err(Diagnostic {
        message: format!(
          "Ambiguous url('{}') in custom property. Relative paths are resolved from the location the var() is used, not where the custom property is defined. Use an absolute URL instead",
          url.url
        ),
        origin: Some("@parcel/transformer-css".into()),
        code_frames: vec![CodeFrame {
          code: None,
          language: Some(AssetType::Css),
          url: Some(self.url.clone()),
          code_highlights: vec![CodeHighlight {
            message: None,
            start: Location {
              line: url.loc.line,
              column: url.loc.column,
            },
            end: Location {
              line: url.loc.line,
              column: url.loc.column,
            },
          }],
        }],
        documentation_url: Some("https://parceljs.org/languages/css/#url()".into()),
        hints: if let Some(url) = self
          .url
          .join(&url.url)
          .relative(&SourceUrl::from_directory_path(&self.project_root))
        {
          vec![format!("Replace with: url(/{})", url)]
        } else {
          Vec::new()
        },
        severity: DiagnosticSeverity::Error,
      });
    }

    self.dependencies.push(Dependency {
      specifier: url.url.to_string().into_boxed_str(),
      specifier_type: SpecifierType::Url,
      priority: Priority::Lazy,
      bundle_behavior: BundleBehavior::None,
      import_type: ImportType::Url,
      flags: DependencyFlags::empty(),
      target: self.unconditional_target.clone(),
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
      conditions: ExportsCondition::empty(),
      resolution: DependencyResolution::None,
    });

    Ok(())
  }
}

pub struct StyleAttrTransformer {}

impl Transformer for StyleAttrTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    options: &ParcelOptions,
    _fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  ) -> Result<Asset, DiagnosticList> {
    let code = asset.content.read()?;
    let code = std::str::from_utf8(&code)?;
    let mut attr = StyleAttribute::parse(
      code,
      ParserOptions {
        filename: asset.loc.url.stable_id(&options.project_root),
        ..Default::default()
      },
    )
    .map_err(|err| convert_error(Some(asset.loc.url.clone()), err))?;

    attr.minify(MinifyOptions {
      targets: Targets {
        browsers: if asset.target.environment.is_browser() {
          let browsers = &asset.target.engines.browsers;
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

    attr.visit(&mut DependencyCollector {
      dependencies: &mut asset.dependencies,
      target: asset.target.clone(),
      unconditional_target: asset.target.clone(),
      import_index: 0,
      url: asset.loc.url.clone(),
      project_root: options.project_root.clone(),
      in_custom_property: false,
    })?;

    asset.content = Arc::new(StyleAttrContent {
      source_size: code.len(),
      attr: attr.into_owned(),
    });
    Ok(asset)
  }
}
