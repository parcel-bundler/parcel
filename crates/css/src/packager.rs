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
    import::ImportRule,
    layer::{LayerBlockRule, LayerName, LayerStatementRule},
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
  /// Whether another stylesheet in the bundle imports this one.
  has_parent: bool,
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
          has_parent: false,
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
          None,
          0,
          &mut visited,
        )?;
      }
    }

    let mut dest = Vec::new();
    // @import rules are only valid before all other rules, but inlined
    // content replaces imports in place, so external and cross-bundle
    // imports that survive to the output are hoisted to a prefix ahead of
    // the inlined rules (position-checked below).
    let mut prefix = Vec::new();
    // The bundler orders eager CSS references before this bundle's assets.
    // Emit them before its own import prelude as well (including external
    // imports), so CSS entries preserve the same cascade as HTML/JS loaders.
    // Conditions are already wrapped inside each referenced bundle.
    for &index in &bundle.referenced_bundles {
      let referenced = &bundle_graph.bundles[index];
      if referenced.ty == AssetType::Css {
        prefix.push(CssRule::Import(ImportRule {
          url: referenced.relative_url(bundle).unwrap().into(),
          layer: None,
          supports: None,
          media: MediaList::new(),
          loc: lightningcss::rules::Location {
            source_index: 0,
            line: 0,
            column: 1,
          },
        }));
      }
    }
    let mut emitted = Vec::new();
    // Absolute layer names declared by statements that could not join the
    // import prefix, in application order; a later hoisted import must
    // re-declare them itself or it would reverse declaration order.
    let mut declared = Vec::new();
    let mut visited = vec![false; stylesheets.len()];
    // Emit by walking the claim forest in source order: importers substitute
    // each finally-claimed import in place, so statements and declarations
    // keep their positions by construction. Roots follow bundle order, which
    // is application order; a leftover pass covers claim cycles.
    for source_index in 0..stylesheets.len() {
      if !visited[source_index] && !stylesheets[source_index].has_parent {
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
          &mut emitted,
          &mut declared,
        )?;
      }
    }
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
          &mut emitted,
          &mut declared,
        )?;
      }
    }
    let mut rules = prefix;
    rules.append(&mut dest);
    let dest = rules;

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

    // Each sheet was already minified at transform time with real targets.
    // Minifying the assembled sheet again would merge same-name @layer
    // blocks across intervening rules — including into an earlier @layer
    // statement — which reorders same-layer rules across an @media or other
    // block and changes which declaration wins (lightningcss merges layer
    // blocks by name without checking what stands between them). Skip it;
    // the printer still applies browser targets.

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
  parent: Option<usize>,
  parent_dep_index: usize,
  visited: &mut Vec<bool>,
) -> Result<(), DiagnosticList> {
  let stylesheet = &mut stylesheets[stylesheet_index];

  // In browsers, every instance of an @import is evaluated, so we preserve the last.
  // Conditions do not need tracking here: each accumulated @import condition is a
  // separate asset, wrapped from its own target when inlined.
  if let Some(parent) = parent {
    stylesheet.parent_stylesheet_index = parent;
    stylesheet.parent_dep_index = parent_dep_index;
    stylesheet.has_parent = true;
  }

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
            // The bundle's asset order is the authoritative application
            // order. A claim is only usable when inlining the child at this
            // site emits it at exactly its planned position: the child
            // precedes this importer in the bundle, and no closer following
            // importer also claims it (ties keep the later @import of one
            // sheet — in browsers the last instance wins). A repeated
            // import whose winning site lies in another bundle otherwise
            // pulls the content to its first occurrence. Rejected sites
            // fall back to the skipped-instance path, which emits the
            // first-occurrence layer declarations.
            let claim = {
              let child = &stylesheets[*child_index];
              *child_index < stylesheet_index
                && (!child.has_parent
                  || stylesheet_index < child.parent_stylesheet_index
                  || (stylesheet_index == child.parent_stylesheet_index
                    && dep_index > child.parent_dep_index))
            };
            collect(
              bundle_graph,
              asset_index_to_stylesheet_index,
              stylesheets,
              *child_index,
              claim.then_some(stylesheet_index),
              dep_index,
              visited,
            )?;
          }
        }
        dep_index += 1;
      }
      // Statements are emitted in place during inlining. Minification can
      // leave Ignored placeholders in the prefix.
      CssRule::LayerStatement(_) | CssRule::Ignored => {}
      _ => break,
    }
  }

  // CSS module dependencies (composes, var() references) are hoisted before
  // this stylesheet when inlining; claim them here so that hoist matches on
  // real parent links. Unlike repeated @imports (last instance wins), a
  // module dependency executes at its FIRST importer, so never re-claim.
  for (dep_index, dep) in asset.dependencies.iter().enumerate() {
    if dep.specifier_type == SpecifierType::Esm {
      if let BundleGraphDependencyResolution::Asset(asset_index) =
        bundle_graph.dependency_resolution(asset_index, dep_index)
      {
        if let Some(child_index) = asset_index_to_stylesheet_index.get(&asset_index) {
          let parent = if stylesheets[*child_index].has_parent {
            None
          } else {
            Some(stylesheet_index)
          };
          collect(
            bundle_graph,
            asset_index_to_stylesheet_index,
            stylesheets,
            *child_index,
            parent,
            dep_index,
            visited,
          )?;
        }
      }
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
  emitted: &mut Vec<usize>,
  declared: &mut Vec<String>,
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
  let own_condition = asset.target.style_condition.as_deref();
  let own_path = own_condition
    .map(|c| dotted_layers(&c.layers))
    .unwrap_or_default();
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
          if resolved.has_parent
            && resolved.parent_stylesheet_index == stylesheet_index
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
              emitted,
              declared,
            )?;
          }
        }
      }
    }
  }

  // Process the import prefix in source order: statements emit here, final
  // imports substitute in place, skipped repeats declare their layers here,
  // and surviving imports hoist (position-checked). In-place processing
  // keeps every declaration event at its source position by construction.
  let mut dep_index = 0;
  let mut has_bundled_import = false;
  for rule in &mut rules {
    match rule {
      CssRule::Import(import) => {
        let dep = &asset.dependencies[dep_index];
        match bundle_graph.dependency_resolution(asset_index, dep_index) {
          BundleGraphDependencyResolution::Asset(child) => {
            if let Some(dep_source_index) = asset_index_to_stylesheet_index.get(&child) {
              let resolved = &stylesheets[*dep_source_index];

              // Include the dependency if this is the last instance as computed earlier.
              if resolved.has_parent
                && resolved.parent_stylesheet_index == stylesheet_index
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
                  emitted,
                  declared,
                )?;
              } else {
                // In browsers every @import instance applies, so a skipped
                // earlier instance still declares its layers — and every
                // layer declared throughout its import closure — at this
                // position, under this site's conditions.
                let site_layers = match &dep.target.style_condition {
                  Some(condition) => {
                    let delta = &condition.layers[own_condition.map_or(0, |o| o.layers.len())..];
                    check_no_anonymous(delta, &dep.specifier)?;
                    dotted_layers(delta)
                  }
                  None => String::new(),
                };
                // The site's media/supports come from the rule itself: the
                // accumulated condition lists are sorted, so the site's
                // contribution cannot be recovered by slicing them.
                let mut media = Vec::new();
                let mut supports = Vec::new();
                if !import.media.media_queries.is_empty() {
                  media.push(
                    import
                      .media
                      .to_css_string(PrinterOptions::default())
                      .map_err(|e| Diagnostic::from_message(e.to_string()))?
                      .into(),
                  );
                }
                if let Some(condition) = &import.supports {
                  supports.push(
                    condition
                      .to_css_string(PrinterOptions::default())
                      .map_err(|e| Diagnostic::from_message(e.to_string()))?
                      .into(),
                  );
                }
                let mut declarations = Vec::new();
                if !site_layers.is_empty() {
                  declarations.push((site_layers.clone(), snapshot(&media, &supports)));
                }
                collect_declarations(
                  bundle_graph,
                  child,
                  &site_layers,
                  &mut media,
                  &mut supports,
                  &mut HashSet::new(),
                  &mut declarations,
                )?;
                for (name, condition) in declarations {
                  let statement = CssRule::LayerStatement(LayerStatementRule {
                    names: vec![
                      LayerName::parse_string(&name)
                        .map_err(|e| Diagnostic::from_message(e.to_string()))?
                        .into_owned(),
                    ],
                    loc,
                  });
                  let mut wrapped = wrap_in_media_supports(vec![statement], &condition, loc)?;
                  if let Some(condition) = own_condition {
                    wrapped = wrap_in_condition(wrapped, condition, loc)?;
                  }
                  let names = [join_path(&own_path, &name)];
                  emit_statement(wrapped.pop().unwrap(), &names, prefix, dest, declared);
                }
              }
              has_bundled_import = true;
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
            check_declared_order(declared, dep)?;
            check_import_position(
              stylesheets,
              stylesheet_index,
              has_bundled_import,
              emitted,
              &import.url,
            )?;
            prefix.push(std::mem::replace(rule, CssRule::Ignored));
          }
          _ => {
            // A surviving import inherits the accumulated condition of its
            // import chain (the dep target composes the importing sheet's
            // condition with this rule's own layer/media/supports).
            let keep = match &dep.target.style_condition {
              Some(condition) => apply_import_condition(import, condition, &dep.specifier)?,
              None => true,
            };
            if keep {
              check_declared_order(declared, dep)?;
              check_import_position(
                stylesheets,
                stylesheet_index,
                has_bundled_import,
                emitted,
                &import.url,
              )?;
              prefix.push(std::mem::replace(rule, CssRule::Ignored));
            } else {
              // The combined media condition can never match.
              *rule = CssRule::Ignored;
            }
          }
        }

        dep_index += 1;
      }
      CssRule::LayerStatement(statement) => {
        // Emit at this source position, after anything an earlier import
        // contributed and before anything a later one will.
        let names: Vec<String> = statement
          .names
          .iter()
          .map(|name| join_path(&own_path, &name_to_string(name)))
          .collect();
        let statement = std::mem::replace(rule, CssRule::Ignored);
        let mut wrapped = vec![statement];
        if let Some(condition) = own_condition {
          wrapped = wrap_in_condition(wrapped, condition, loc)?;
        }
        emit_statement(wrapped.pop().unwrap(), &names, prefix, dest, declared);
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
    rules = wrap_in_condition(rules, condition, loc)?;
  }

  emitted.push(stylesheet_index);
  dest.extend(rules);
  Ok(())
}

/// A bare @layer statement is legal among @import rules, so while nothing
/// has been emitted it may join the import prefix at the current position,
/// staying ahead of surviving imports pushed later in the walk. Anything
/// else — a condition-wrapped statement — is not valid there and must
/// follow the prefix; its declared names are recorded so a later hoisted
/// import cannot silently jump ahead of them.
fn emit_statement(
  rule: CssRule<'static>,
  names: &[String],
  prefix: &mut Vec<CssRule<'static>>,
  dest: &mut Vec<CssRule<'static>>,
  declared: &mut Vec<String>,
) {
  match &rule {
    CssRule::LayerStatement(_) if dest.is_empty() => prefix.push(rule),
    _ => {
      dest.push(rule);
      declared.extend(names.iter().cloned());
    }
  }
}

/// A hoisted surviving import lands above every statement that was routed to
/// dest. That reverses declaration order unless the import's own layer path
/// re-declares those layers itself (each is a prefix of the path).
fn check_declared_order(declared: &[String], dep: &Dependency) -> Result<(), DiagnosticList> {
  let import_path = dep
    .target
    .style_condition
    .as_ref()
    .map(|c| dotted_layers(&c.layers))
    .unwrap_or_default();
  for name in declared {
    let safe = *name == import_path
      || (import_path.len() > name.len()
        && import_path.starts_with(name.as_str())
        && import_path.as_bytes()[name.len()] == b'.');
    if !safe {
      return Err(
        Diagnostic::from_message(format!(
          "@import of \"{}\" cannot preserve layer order: the conditional @layer declaration of \"{name}\" precedes it, but cannot appear before @import rules.",
          dep.specifier
        ))
        .into(),
      );
    }
  }
  Ok(())
}

fn join_path(prefix: &str, name: &str) -> String {
  if prefix.is_empty() {
    name.to_string()
  } else if name.is_empty() {
    prefix.to_string()
  } else {
    format!("{prefix}.{name}")
  }
}

/// Each browser evaluation of an anonymous layer creates a DISTINCT layer,
/// so a repeated occurrence cannot be represented by the merged, named
/// emission bundling uses; its priority would silently change. Reject.
fn check_no_anonymous(layers: &[StyleLayer], specifier: &str) -> Result<(), DiagnosticList> {
  if layers
    .iter()
    .any(|layer| matches!(layer, StyleLayer::Anonymous(_)))
  {
    return Err(
      Diagnostic::from_message(format!(
        "Repeated @import of \"{specifier}\" involves an anonymous layer, and every occurrence of an anonymous layer is a distinct layer. Use a named layer instead."
      ))
      .into(),
    );
  }
  Ok(())
}

/// The media/supports conditions a declaration is subject to, as a condition
/// the standard wrappers understand. Nesting order between media and
/// supports is irrelevant: wrapping is conjunction.
fn snapshot(media: &[Box<str>], supports: &[Box<str>]) -> StyleCondition {
  StyleCondition {
    layers: Vec::new(),
    media: media.to_vec(),
    supports: supports.to_vec(),
  }
}

/// Every layer declared by a stylesheet and its import closure, in source
/// order, with the media/supports conditions each declaration is subject
/// to. Paths are relative to `path` (the site importing this stylesheet);
/// conditions are read from the rules themselves.
fn collect_declarations(
  bundle_graph: &BundleGraph,
  asset_index: AssetIndex,
  path: &str,
  media: &mut Vec<Box<str>>,
  supports: &mut Vec<Box<str>>,
  visited: &mut HashSet<AssetIndex>,
  out: &mut Vec<(String, StyleCondition)>,
) -> Result<(), DiagnosticList> {
  if !visited.insert(asset_index) {
    return Ok(());
  }
  let asset = &bundle_graph.asset_graph.asset(asset_index);
  let Some(content) = asset.content.downcast_ref::<CssContent>() else {
    return Ok(());
  };
  let own_layers = asset
    .target
    .style_condition
    .as_ref()
    .map_or(0, |c| c.layers.len());

  let mut dep_index = 0;
  for rule in &content.stylesheet.rules.0 {
    match rule {
      CssRule::Import(import) => {
        let dep = &asset.dependencies[dep_index];
        // The site's own layer contribution; layers compose by appending,
        // so slicing off the sheet's own path is exact (and covers the
        // generated name of an anonymous `layer` clause).
        let site_layers = match &dep.target.style_condition {
          Some(condition) => {
            let delta = &condition.layers[own_layers..];
            check_no_anonymous(delta, &dep.specifier)?;
            dotted_layers(delta)
          }
          None => String::new(),
        };
        let child_path = join_path(path, &site_layers);
        let media_depth = media.len();
        let supports_depth = supports.len();
        if !import.media.media_queries.is_empty() {
          media.push(
            import
              .media
              .to_css_string(PrinterOptions::default())
              .map_err(|e| Diagnostic::from_message(e.to_string()))?
              .into(),
          );
        }
        if let Some(condition) = &import.supports {
          supports.push(
            condition
              .to_css_string(PrinterOptions::default())
              .map_err(|e| Diagnostic::from_message(e.to_string()))?
              .into(),
          );
        }
        if !site_layers.is_empty() {
          out.push((child_path.clone(), snapshot(media, supports)));
        }
        if let BundleGraphDependencyResolution::Asset(child) =
          bundle_graph.dependency_resolution(asset_index, dep_index)
        {
          collect_declarations(
            bundle_graph,
            child,
            &child_path,
            media,
            supports,
            visited,
            out,
          )?;
        }
        media.truncate(media_depth);
        supports.truncate(supports_depth);
        dep_index += 1;
      }
      rule => declarations_in_rule(rule, path, media, supports, out)?,
    }
  }
  Ok(())
}

/// Layer declarations within a rule, recursing through nested @layer,
/// @media, and @supports blocks. Anonymous layer blocks are skipped: their
/// layers cannot be referenced by name from outside.
fn declarations_in_rule(
  rule: &CssRule<'static>,
  path: &str,
  media: &mut Vec<Box<str>>,
  supports: &mut Vec<Box<str>>,
  out: &mut Vec<(String, StyleCondition)>,
) -> Result<(), DiagnosticList> {
  match rule {
    CssRule::LayerStatement(statement) => {
      for name in &statement.names {
        out.push((
          join_path(path, &name_to_string(name)),
          snapshot(media, supports),
        ));
      }
    }
    CssRule::LayerBlock(block) => match &block.name {
      Some(name) => {
        let path = join_path(path, &name_to_string(name));
        out.push((path.clone(), snapshot(media, supports)));
        for rule in &block.rules.0 {
          declarations_in_rule(rule, &path, media, supports, out)?;
        }
      }
      // Every occurrence of an anonymous layer is a distinct layer, so a
      // repeated application cannot be represented by one merged block.
      None => {
        return Err(
          Diagnostic::from_message(
            "A repeated @import applies a stylesheet with an anonymous @layer block, and every occurrence of an anonymous layer is a distinct layer. Use a named layer instead.".to_string(),
          )
          .into(),
        );
      }
    },
    CssRule::Media(rule) => {
      media.push(
        rule
          .query
          .to_css_string(PrinterOptions::default())
          .map_err(|e| Diagnostic::from_message(e.to_string()))?
          .into(),
      );
      for rule in &rule.rules.0 {
        declarations_in_rule(rule, path, media, supports, out)?;
      }
      media.pop();
    }
    CssRule::Supports(rule) => {
      supports.push(
        rule
          .condition
          .to_css_string(PrinterOptions::default())
          .map_err(|e| Diagnostic::from_message(e.to_string()))?
          .into(),
      );
      for rule in &rule.rules.0 {
        declarations_in_rule(rule, path, media, supports, out)?;
      }
      supports.pop();
    }
    _ => {}
  }
  Ok(())
}

fn dotted_layers(layers: &[StyleLayer]) -> String {
  layers
    .iter()
    .map(|layer| {
      let (StyleLayer::Named(name) | StyleLayer::Anonymous(name)) = layer;
      &**name
    })
    .collect::<Vec<_>>()
    .join(".")
}

fn name_to_string(name: &LayerName) -> String {
  name
    .0
    .iter()
    .map(|part| part.as_ref())
    .collect::<Vec<_>>()
    .join(".")
}

fn wrap_in_condition(
  mut rules: Vec<CssRule<'static>>,
  condition: &StyleCondition,
  loc: lightningcss::rules::Location,
) -> Result<Vec<CssRule<'static>>, DiagnosticList> {
  for layer in condition.layers.iter().rev() {
    // Anonymous import sites carry a generated name so every inheriting
    // asset stays in the same layer; emitting a fresh anonymous block per
    // asset would split one logical layer into several.
    let (StyleLayer::Named(name) | StyleLayer::Anonymous(name)) = layer;
    let name = Some(
      LayerName::parse_string(name)
        .map_err(|e| Diagnostic::from_message(e.to_string()))?
        .into_owned(),
    );
    rules = vec![CssRule::LayerBlock(LayerBlockRule {
      name,
      rules: CssRuleList(rules),
      loc,
    })]
  }
  wrap_in_media_supports(rules, condition, loc)
}

fn wrap_in_media_supports(
  mut rules: Vec<CssRule<'static>>,
  condition: &StyleCondition,
  loc: lightningcss::rules::Location,
) -> Result<Vec<CssRule<'static>>, DiagnosticList> {
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
  Ok(rules)
}

/// The condition's full layer path as a single @layer name.
fn layer_path(condition: &StyleCondition) -> Result<LayerName<'static>, DiagnosticList> {
  let path = condition
    .layers
    .iter()
    .map(|layer| {
      let (StyleLayer::Named(name) | StyleLayer::Anonymous(name)) = layer;
      &**name
    })
    .collect::<Vec<_>>()
    .join(".");
  Ok(
    LayerName::parse_string(&path)
      .map_err(|e| Diagnostic::from_message(e.to_string()))?
      .into_owned(),
  )
}

/// Rewrite a surviving @import's layer/media/supports to the accumulated
/// condition of its import chain, so it keeps applying under the conditions
/// of the sheet that imported it. Returns false when the combined media can
/// never match (the import is dropped); errors on conditions that cannot be
/// represented on a flat @import rule.
fn apply_import_condition(
  import: &mut lightningcss::rules::import::ImportRule<'static>,
  condition: &StyleCondition,
  specifier: &str,
) -> Result<bool, DiagnosticList> {
  import.layer = if condition.layers.is_empty() {
    None
  } else {
    Some(Some(layer_path(condition)?))
  };

  let mut supports = condition
    .supports
    .iter()
    .map(|s| {
      SupportsCondition::parse_string(s)
        .map(|c| c.into_owned())
        .map_err(|e| DiagnosticList::from(Diagnostic::from_message(e.to_string())))
    })
    .collect::<Result<Vec<_>, _>>()?;
  import.supports = match supports.len() {
    0 => None,
    1 => supports.pop(),
    _ => Some(SupportsCondition::And(supports)),
  };

  // Conjoin the accumulated media query lists: distribute AND over each
  // list's queries, dropping pairs that can never match together.
  let mut merged: Option<MediaList> = None;
  for media in &condition.media {
    let mut input = cssparser::ParserInput::new(media);
    let mut parser = cssparser::Parser::new(&mut input);
    let next = MediaList::parse(&mut parser, &ParserOptions::default())
      .map_err(|e| Diagnostic::from_message(e.to_string()))?
      .into_owned();
    merged = Some(match merged {
      None => next,
      Some(previous) => {
        let mut queries = Vec::new();
        for a in &previous.media_queries {
          for b in &next.media_queries {
            if let Some(query) = and_query(a, b, specifier)? {
              queries.push(query);
            }
          }
        }
        let mut list = MediaList::new();
        list.media_queries = queries;
        list
      }
    });
  }
  match merged {
    Some(list) if list.media_queries.is_empty() => return Ok(false),
    Some(list) => import.media = list,
    None => import.media = MediaList::new(),
  }
  Ok(true)
}

/// The conjunction of two media queries, or None when they can never match
/// together. `not` queries have no flat conjunction on one query; reject.
fn and_query(
  a: &lightningcss::media_query::MediaQuery<'static>,
  b: &lightningcss::media_query::MediaQuery<'static>,
  specifier: &str,
) -> Result<Option<lightningcss::media_query::MediaQuery<'static>>, DiagnosticList> {
  use lightningcss::media_query::{MediaCondition, MediaQuery, MediaType, Operator, Qualifier};
  if a.qualifier == Some(Qualifier::Not) || b.qualifier == Some(Qualifier::Not) {
    return Err(
      Diagnostic::from_message(format!(
        "@import of \"{specifier}\" cannot preserve its conditions: `not` media queries cannot be combined on a single @import rule."
      ))
      .into(),
    );
  }
  let media_type = match (&a.media_type, &b.media_type) {
    (MediaType::All, t) | (t, MediaType::All) => t.clone(),
    (x, y) if x == y => x.clone(),
    _ => return Ok(None),
  };
  let condition = match (a.condition.clone(), b.condition.clone()) {
    (None, c) | (c, None) => c,
    (Some(x), Some(y)) => Some(MediaCondition::Operation {
      operator: Operator::And,
      conditions: vec![x, y],
    }),
  };
  Ok(Some(MediaQuery {
    qualifier: None,
    media_type,
    condition,
  }))
}

/// A hoisted @import is only order-preserving when nothing that applies
/// before it has already been emitted: no bundled import earlier in the same
/// sheet, and no already-emitted sheet outside this sheet's own import
/// subtree (a sheet's own imports apply after its leading @import rules).
fn check_import_position(
  stylesheets: &[StyleSheetWrapper],
  stylesheet_index: usize,
  has_bundled_import: bool,
  emitted: &[usize],
  url: &str,
) -> Result<(), DiagnosticList> {
  let mut safe = !has_bundled_import;
  if safe {
    'emitted: for &index in emitted {
      let mut current = index;
      for _ in 0..=stylesheets.len() {
        if current == stylesheet_index {
          continue 'emitted;
        }
        if !stylesheets[current].has_parent {
          break;
        }
        current = stylesheets[current].parent_stylesheet_index;
      }
      safe = false;
      break;
    }
  }
  if safe {
    Ok(())
  } else {
    Err(
      Diagnostic::from_message(format!(
        "@import of \"{url}\" cannot preserve its cascade position: it must appear before all bundled CSS rules."
      ))
      .into(),
    )
  }
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
