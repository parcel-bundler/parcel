use std::borrow::{Borrow, Cow};
use std::cell::RefCell;
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::Arc;

use crate::arena::{Node, NodeData, SerializableHandle, Sink};
use crate::srcset::{parse_srcset, serialize_srcset};
use crate::xml::{ATOM_NS, EmbeddedContent, expand_html_in, is_rss};
use html5ever::tendril::{StrTendril, format_tendril};
use html5ever::{Attribute, ExpandedName, QualName, expanded_name, local_name, namespace_url, ns};
use parcel_core::{
  Asset, AssetFlags, AssetRequest, AssetSymbols, AssetType, BufferContent, BundleBehavior,
  CodeFrame, CodeHighlight, Dependency, DependencyFlags, DependencyResolution, Diagnostic,
  DiagnosticSeverity, EnvironmentFeature, ExportsCondition, ImportType, ImportedSymbol, Location,
  OutputFormat, ParcelOptions, Priority, SourceLocation, SourceType, SourceUrl, SpecifierType,
  SymbolResolution, Target, UrlReference,
};
use typed_arena::Arena;
use xml5ever::LocalName;
use xml5ever::interface::ElemName;
use xml5ever::tendril::TendrilSink;

/// Parse and canonically re-serialize a media attribute, matching the
/// canonical form the CSS transformer uses for `@import` conditions. Returns
/// None for an empty, invalid, or vacuous (`all`) query, which never seeds a
/// style condition.
fn canonical_media(value: &str) -> Option<Box<str>> {
  let mut input = cssparser::ParserInput::new(value);
  let mut parser = cssparser::Parser::new(&mut input);
  let media = lightningcss::media_query::MediaList::parse(
    &mut parser,
    &lightningcss::stylesheet::ParserOptions::default(),
  )
  .ok()?;
  if media.media_queries.is_empty() {
    return None;
  }
  let css = lightningcss::traits::ToCss::to_css_string(
    &media,
    lightningcss::printer::PrinterOptions {
      minify: true,
      ..Default::default()
    },
  )
  .ok()?;
  if css == "all" {
    None
  } else {
    Some(css.into_boxed_str())
  }
}

pub fn collect_dependencies<'arena, 'a>(
  arena: &'arena Arena<Node<'arena>>,
  dom: &'arena Node<'arena>,
  url: SourceUrl,
  ty: AssetType,
  target: Arc<Target>,
  hmr: bool,
  options: &'a ParcelOptions,
  macro_imports: &[(String, String)],
) -> (
  Vec<Dependency>,
  Vec<ImportedSymbol>,
  Vec<Asset>,
  Vec<Diagnostic>,
) {
  let (deps, imports, assets, errors, _) =
    collect(arena, dom, url, ty, target, hmr, options, macro_imports);
  (deps, imports, assets, errors)
}

/// Collects the dependencies of an XML document. Also returns the embedded HTML (e.g. Atom
/// `<content type="html">`) that macros produced, which was expanded so it could be walked, and
/// must be collapsed again along with the rest.
pub(crate) fn collect_xml_dependencies<'arena, 'a>(
  arena: &'arena Arena<Node<'arena>>,
  dom: &'arena Node<'arena>,
  url: SourceUrl,
  target: Arc<Target>,
  options: &'a ParcelOptions,
) -> (
  Vec<Dependency>,
  Vec<ImportedSymbol>,
  Vec<Asset>,
  Vec<Diagnostic>,
  Vec<EmbeddedContent<'arena>>,
) {
  collect(arena, dom, url, AssetType::Xml, target, false, options, &[])
}

fn collect<'arena, 'a>(
  arena: &'arena Arena<Node<'arena>>,
  dom: &'arena Node<'arena>,
  url: SourceUrl,
  ty: AssetType,
  target: Arc<Target>,
  hmr: bool,
  options: &'a ParcelOptions,
  macro_imports: &[(String, String)],
) -> (
  Vec<Dependency>,
  Vec<ImportedSymbol>,
  Vec<Asset>,
  Vec<Diagnostic>,
  Vec<EmbeddedContent<'arena>>,
) {
  let mut collector = DependencyCollector::new(arena, url, ty, target, options);
  // Macros configured for every document, as if declared with <parcel:define>. Imports in the
  // document itself take precedence.
  collector
    .macro_imports
    .extend(macro_imports.iter().cloned());
  collector.rss = collector.ty == AssetType::Xml && is_rss(dom);
  collector.root = Some(dom);

  collector.walk(dom);

  for asset in &collector.assets {
    collector.deps.push(Dependency {
      specifier: asset
        .unique_key
        .clone()
        .unwrap()
        .to_string()
        .into_boxed_str(),
      specifier_type: SpecifierType::Esm,
      flags: DependencyFlags::empty(),
      priority: Priority::Sync,
      target: asset.target.clone(),
      bundle_behavior: BundleBehavior::Inline,
      import_type: ImportType::JavaScript,
      placeholder: asset
        .unique_key
        .clone()
        .map(|s| s.to_string().into_boxed_str()),
      loc: None,
      resolve_from: None,
      range: None,
      conditions: ExportsCondition::empty(),
      resolution: DependencyResolution::Deferred(Arc::new(AssetRequest {
        loc: asset.loc.clone(),
        ty: asset.ty.clone(),
        content: asset.content.clone(),
        pipeline: None,
        target: asset.target.clone(),
        side_effects: true,
        unique_key: asset.unique_key.clone(),
      })),
      concurrent_group: 0,
      custom_conditions: Default::default(),
    });
  }

  // Pages without module scripts get an empty script, so that they include the HMR runtime and
  // reload when they change.
  if hmr && !collector.has_module_scripts {
    if let Some(body) = dom.find(expanded_name!(html "body")) {
      let target = collector.create_env(OutputFormat::Global, SourceType::Module);
      let mut dep = Dependency {
        specifier: "hmr.js".into(),
        specifier_type: SpecifierType::Url,
        priority: Priority::Parallel,
        target: target.clone(),
        flags: DependencyFlags::empty(),
        bundle_behavior: BundleBehavior::Isolated,
        import_type: ImportType::Url,
        placeholder: Default::default(),
        loc: None,
        resolve_from: Some(collector.url.clone()),
        range: None,
        conditions: ExportsCondition::empty(),
        resolution: DependencyResolution::Deferred(Arc::new(AssetRequest {
          loc: SourceLocation {
            url: collector.url.clone(),
            start: Default::default(),
            end: Default::default(),
          },
          ty: AssetType::Js,
          content: Arc::new(BufferContent::new(Vec::new())),
          pipeline: None,
          target,
          side_effects: true,
          unique_key: Some("hmr.js".into()),
        })),
        concurrent_group: 0,
        custom_conditions: Default::default(),
      };
      let src: StrTendril = dep.set_placeholder().into();
      collector.deps.push(dep);

      let script = NodeData::Element {
        name: QualName::new(None, ns!(html), local_name!("script")),
        attrs: RefCell::new(vec![Attribute {
          name: QualName::new(None, ns!(), local_name!("src")),
          value: src,
        }]),
        template_contents: None,
        mathml_annotation_xml_integration_point: false,
      };

      body.append(arena.alloc(Node::new(script, 0)));
    }
  }

  if !collector.hoisted.is_empty() {
    if let Some(head) = dom.find(expanded_name!(html "head")) {
      crate::head::insert_into_head(head, std::mem::take(&mut collector.hoisted));
    }
  }

  (
    collector.deps,
    collector.imports,
    collector.assets,
    collector.errors,
    collector.embedded,
  )
}

struct DependencyCollector<'arena, 'a> {
  arena: &'arena Arena<Node<'arena>>,
  url: SourceUrl,
  ty: AssetType,
  target: Arc<Target>,
  deps: Vec<Dependency>,
  imports: Vec<ImportedSymbol>,
  assets: Vec<Asset>,
  key: u32,
  has_module_scripts: bool,
  errors: Vec<Diagnostic>,
  rss: bool,
  options: &'a ParcelOptions,
  macro_imports: HashMap<String, String>,
  /// Imported macro elements whose output is currently being walked. An element isn't expanded
  /// again within its own output, so a macro can render the native element it's named after.
  expanding_imports: Vec<String>,
  /// Embedded HTML in the output of macros in XML documents. See `collect_xml_dependencies`.
  embedded: Vec<EmbeddedContent<'arena>>,
  /// The document root, and the head elements produced by macros, hoisted after the walk.
  root: Option<&'arena Node<'arena>>,
  hoisted: Vec<&'arena Node<'arena>>,
}

impl<'arena, 'a> DependencyCollector<'arena, 'a> {
  /// Visits `node` and its descendants (including `<template>` contents) in document order.
  /// Visiting may replace a node (e.g. a macro with its output), in which case the replacement
  /// is walked by the visitor itself.
  fn walk(&mut self, node: &'arena Node<'arena>) {
    self.visit_node(node);
    if let NodeData::Element {
      template_contents: Some(template_contents),
      ..
    } = &node.data
    {
      self.walk(template_contents);
    }

    let mut child = node.first_child.get();
    while let Some(c) = child {
      child = c.next_sibling.get();
      self.walk(c);
    }
  }

  fn visit_node(&mut self, node: &'arena Node<'arena>) {
    match &node.data {
      NodeData::Element { name, .. } => {
        self.visit_element(node, name);
      }
      NodeData::ProcessingInstruction { target, contents } => {
        let mut contents = contents.borrow_mut();
        if target.as_ref() == "xml-stylesheet" {
          if let Ok(mut attrs) = parse_xml_stylesheet(contents.borrow().as_ref()) {
            for attr in &mut attrs {
              if attr.name.expanded() == expanded_name!("", "href") {
                attr.value = self.add_dep(
                  attr.value.clone(),
                  false,
                  Priority::Parallel,
                  node.line,
                  None,
                );
              }
            }

            *contents = serialize_xml_stylesheet(attrs);
          }
        }
      }
      _ => {}
    }
  }

  fn new(
    arena: &'arena Arena<Node<'arena>>,
    url: SourceUrl,
    ty: AssetType,
    target: Arc<Target>,
    options: &'a ParcelOptions,
  ) -> Self {
    DependencyCollector {
      arena,
      url,
      ty,
      target,
      deps: Vec::new(),
      imports: Vec::new(),
      assets: Vec::new(),
      key: 0,
      has_module_scripts: false,
      errors: Vec::new(),
      rss: false,
      options,
      macro_imports: HashMap::new(),
      expanding_imports: Vec::new(),
      embedded: Vec::new(),
      root: None,
      hoisted: Vec::new(),
    }
  }

  fn create_env(&self, output_format: OutputFormat, source_type: SourceType) -> Arc<Target> {
    Arc::new(Target {
      output_format,
      source_type,
      ..(*self.target).clone()
    })
  }

  fn create_loc(&self, line: u32) -> Option<SourceLocation> {
    Some(SourceLocation {
      url: self.url.clone(),
      start: Location { line, column: 1 },
      end: Location { line, column: 2 },
    })
  }

  fn add_diagnostic(&mut self, message: &str, line: u32) {
    self.errors.push(Diagnostic {
      message: message.into(),
      origin: None,
      code_frames: vec![CodeFrame {
        url: Some(self.url.clone()),
        code: None,
        language: Some(self.ty.clone()),
        code_highlights: vec![CodeHighlight::from_loc(
          &self.create_loc(line).unwrap(),
          None,
        )],
      }],
      hints: vec![],
      severity: DiagnosticSeverity::Error,
      documentation_url: None,
    });
  }

  fn visit_element(&mut self, node: &'arena Node<'arena>, name: &QualName) {
    if self.ty == AssetType::Xml {
      if name.ns.as_ref() == ATOM_NS {
        match name.local.as_ref() {
          "link" => self.handle_feed_attr(node, expanded_name!("", "href"), true),
          "icon" | "logo" => self.handle_text_url(node),
          _ => {}
        }
        return;
      }

      if self.rss && name.ns.is_empty() {
        match name.local.as_ref() {
          "link" | "url" | "comments" => self.handle_text_url(node),
          "enclosure" => self.handle_feed_attr(
            node,
            ExpandedName {
              ns: &ns!(),
              local: &"url".into(),
            },
            false,
          ),
          _ => {}
        }
        return;
      }

      // Arbitrary XML vocabularies must not acquire HTML attribute semantics. Parcel's own
      // elements (e.g. <parcel:macro>) are handled below.
      if name.ns != ns!(html) && name.ns != ns!(svg) && name.ns.as_ref() != "http://parceljs.org" {
        return;
      }
    }

    match name.expanded() {
      expanded_name!(html "link") => {
        let href = node.get_attribute(expanded_name!("", "href"));

        if let Some(mut href) = href {
          // Check for empty string
          if href.is_empty() {
            self.add_diagnostic("'href' should not be empty string".into(), node.line);
            return;
          }

          let mut flags = DependencyFlags::empty();
          let mut priority = Priority::Lazy;
          let mut target = self.target.clone();
          let mut reference = None;
          if let Some(rel) = node.get_attribute(expanded_name!("", "rel")) {
            // Icons (icon, apple-touch-icon, mask-icon, etc.) are rendered.
            if rel
              .split_ascii_whitespace()
              .any(|rel| rel.ends_with("icon"))
            {
              reference = Some(UrlReference::Document);
            }
            // Canonical and alternate versions of the page are navigated to. Preloads request
            // nothing, since the symbols they fetch come from wherever the resource is used.
            if rel.as_ref() == "canonical" || rel.as_ref() == "alternate" {
              reference = Some(UrlReference::Document);
            }
            if rel.as_ref() == "canonical" || rel.as_ref() == "manifest" {
              flags |= DependencyFlags::NEEDS_STABLE_NAME;
              if rel.as_ref() == "manifest" && !href.contains(':') {
                // A hack to allow manifest.json rather than manifest.webmanifest.
                // If a custom pipeline is used, it is responsible for running @parcel/transformer-webmanifest.
                href = format_tendril!("webmanifest:{}", href);
              }
            } else if rel.as_ref() == "stylesheet" {
              // Keep in the same bundle group as the HTML.
              priority = Priority::Parallel;
              // Seed the media attribute into the style condition so the
              // stylesheet and its whole import subtree stay gated even when
              // parts are extracted into other bundles. The emitted media
              // attribute is later re-derived from the resolved bundle.
              if let Some(media) = node.get_attribute(expanded_name!("", "media")) {
                if let Some(media) = canonical_media(&media) {
                  target = Arc::new(Target {
                    style_condition: Some(Arc::new(parcel_core::StyleCondition {
                      media: vec![media],
                      ..Default::default()
                    })),
                    ..(*self.target).clone()
                  });
                }
              }
            } else if rel.as_ref() == "alternate" {
              if let Some(t) = node.get_attribute(expanded_name!("", "type")) {
                if t.as_ref() == "application/rss+xml" || t.as_ref() == "application/atom+xml" {
                  flags |= DependencyFlags::NEEDS_STABLE_NAME;
                }
              }
            }
          }

          let mut dep = Dependency {
            specifier: href.to_string().into_boxed_str(),
            specifier_type: SpecifierType::Url,
            flags,
            priority,
            target,
            bundle_behavior: BundleBehavior::None,
            import_type: ImportType::Url,
            placeholder: Default::default(),
            loc: self.create_loc(node.line),
            resolve_from: Some(self.url.clone()),
            range: None,
            conditions: ExportsCondition::empty(),
            resolution: DependencyResolution::None,
            concurrent_group: 0,
            custom_conditions: Default::default(),
          };

          node.set_attribute(expanded_name!("", "href"), dep.set_placeholder());
          self.push_dep(dep, reference);
        }

        let imagesrcset = ExpandedName {
          ns: &ns!(),
          local: &"imagesrcset".into(),
        };

        self.handle_srcset(node, imagesrcset, node.line);
      }
      expanded_name!(html "script") | expanded_name!(svg "script") => {
        let is_svg = name.ns == ns!(svg);
        let href = expanded_name!(xlink "href");
        let src_attr = if is_svg {
          if node.get_attribute(href).is_some() {
            href
          } else {
            expanded_name!("", "href")
          }
        } else {
          expanded_name!("", "src")
        };
        let src = node.get_attribute(src_attr);
        let ty = node.get_attribute(expanded_name!("", "type"));
        let mut output_format = OutputFormat::Global;
        let source_type = match &ty {
          Some(t) if t.as_ref() == "module" => {
            self.has_module_scripts = true;
            SourceType::Module
          }
          _ => SourceType::Script,
        };

        if let Some(src) = src {
          // Check for empty string
          if src.is_empty() {
            self.add_diagnostic("'src' should not be empty string".into(), node.line);
            return;
          }

          if source_type == SourceType::Module
            && self.target.engines.supports(EnvironmentFeature::Esmodules)
            && !is_svg
          {
            output_format = OutputFormat::Esmodule;
          }

          if output_format != OutputFormat::Esmodule {
            if source_type == SourceType::Module && !is_svg {
              node.set_attribute(expanded_name!("", "defer"), "");
            }
            node.remove_attribute(expanded_name!("", "type"));
          }

          // If the script is async it can be executed in any order, so it cannot depend
          // on any sibling scripts for dependencies. Keep all dependencies together.
          let mut bundle_behavior = BundleBehavior::None;
          if source_type == SourceType::Script
            || node.get_attribute(expanded_name!("", "async")).is_some()
          {
            bundle_behavior = BundleBehavior::Isolated;
          }

          let mut dep = Dependency {
            specifier: src.to_string().into_boxed_str(),
            specifier_type: SpecifierType::Url,
            priority: Priority::Parallel,
            target: self.create_env(output_format, source_type),
            flags: DependencyFlags::empty(),
            bundle_behavior,
            import_type: ImportType::Url,
            placeholder: Default::default(),
            loc: self.create_loc(node.line),
            resolve_from: Some(self.url.clone()),
            range: None,
            conditions: ExportsCondition::empty(),
            resolution: DependencyResolution::None,
            concurrent_group: 0,
            custom_conditions: Default::default(),
          };

          node.set_attribute(src_attr, dep.set_placeholder());
          self.deps.push(dep);
        } else {
          if let Some(ty) = &ty {
            if ty.as_ref() == "application/json"
              || ty.as_ref() == "text/html"
              || ty.as_ref() == "importmap"
            {
              return;
            }
          }

          let code = node.text_content();

          if source_type == SourceType::Module {
            if self.target.engines.supports(EnvironmentFeature::Esmodules) && !is_svg {
              output_format = OutputFormat::Esmodule;
            } else {
              node.remove_attribute(expanded_name!("", "type"));
            }
          }

          let data_parcel_key = ExpandedName {
            ns: &ns!(),
            local: &"data-parcel-key".into(),
          };

          let key = if let Some(key) = node.get_attribute(data_parcel_key.clone()) {
            key
          } else {
            let key: StrTendril = format_tendril!("asset-{}", self.key);
            node.set_attribute(data_parcel_key, &key);
            self.key += 1;
            key
          };

          self.assets.push(Asset {
            ty: ty
              .map(|ty| AssetType::from_mime(&ty))
              .unwrap_or(AssetType::Js),
            content: Arc::new(BufferContent::new_string(code)),
            unique_key: Some(key.to_string().into()),
            flags: AssetFlags::IS_HTML_TAG,
            target: self.create_env(output_format, source_type),
            bundle_behavior: BundleBehavior::Inline,
            loc: self.create_loc(node.line).unwrap(),
            pipeline: None,
            dependencies: Vec::new(),
            symbols: AssetSymbols::default(),
          });
        }
      }
      expanded_name!(html "style") | expanded_name!(svg "style") => {
        let code = node.text_content();
        let data_parcel_key = ExpandedName {
          ns: &ns!(),
          local: &"data-parcel-key".into(),
        };

        let key = if let Some(key) = node.get_attribute(data_parcel_key.clone()) {
          key
        } else {
          let key: StrTendril = format_tendril!("asset-{}", self.key);
          node.set_attribute(data_parcel_key, &key);
          self.key += 1;
          key
        };

        let ty = if let Some(ty) = node.get_attribute(expanded_name!("", "type")) {
          node.remove_attribute(expanded_name!("", "type"));
          AssetType::from_mime(&ty)
        } else {
          AssetType::Css
        };

        self.assets.push(Asset {
          ty,
          content: Arc::new(BufferContent::new_string(code)),
          unique_key: Some(key.to_string().into()),
          flags: AssetFlags::IS_HTML_TAG,
          target: self.target.clone(),
          bundle_behavior: BundleBehavior::Inline,
          loc: self.create_loc(node.line).unwrap(),
          pipeline: None,
          dependencies: Vec::new(),
          symbols: AssetSymbols::default(),
        });
      }
      expanded_name!(html "meta") => {
        // A list of metadata that should produce a dependency
        // Based on:
        // - http://schema.org/
        // - http://ogp.me
        // - https://developer.twitter.com/en/docs/tweets/optimize-with-cards/overview/markup
        // - https://msdn.microsoft.com/en-us/library/dn255024.aspx
        // - https://vk.com/dev/publications
        let mut is_dep = false;
        let mut needs_stable_name = true;
        if node
          .get_attribute(expanded_name!("", "http-equiv"))
          .is_some_and(|v| v.eq_ignore_ascii_case("refresh"))
        {
          // <meta http-equiv="refresh" content="N; url=URL"> redirects to URL. The delay is kept
          // in a temporary attribute so the URL can be replaced like any other during packaging.
          if let Some(content) = node.get_attribute(expanded_name!("", "content")) {
            // Like links, URLs without an extension are virtual paths (e.g. /docs/), left as is.
            let parsed = parse_refresh(&content).filter(|(_, url)| {
              let path = url.split(['#', '?']).next().unwrap_or(url);
              path.rfind('.').unwrap_or(0) >= 1
            });
            if let Some((delay, url)) = parsed {
              let placeholder = self.add_dep(
                url.into(),
                false,
                Priority::Lazy,
                node.line,
                Some(UrlReference::Document),
              );
              node.set_attribute(expanded_name!("", "content"), &placeholder);
              node.set_attribute(
                ExpandedName {
                  ns: &ns!(),
                  local: &"data-parcel-refresh".into(),
                },
                delay,
              );
            }
          }
        } else if let Some(property) = node.get_attribute(expanded_name!("", "property")) {
          is_dep = matches!(
            property.as_ref(),
            "og:image"
              | "og:image:url"
              | "og:image:secure_url"
              | "og:audio"
              | "og:audio:secure_url"
              | "og:video"
              | "og:video:secure_url"
              | "vk:image"
          );
        } else if let Some(name) = node.get_attribute(expanded_name!("", "name")) {
          if name.as_ref() == "twitter:image" {
            is_dep = true;
          } else if name.as_ref() == "msapplication-config" {
            if let Some(content) = node.get_attribute(expanded_name!("", "content")) {
              is_dep = content.as_ref() != "none";
            }
          } else {
            is_dep = matches!(
              name.as_ref(),
              "msapplication-square150x150logo"
                | "msapplication-square310x310logo"
                | "msapplication-square70x70logo"
                | "msapplication-wide310x150logo"
                | "msapplication-TileImage"
            );
            needs_stable_name = false;
          }
        } else if let Some(itemprop) = node.get_attribute(expanded_name!("", "itemprop")) {
          is_dep = matches!(
            itemprop.as_ref(),
            "image" | "logo" | "screenshot" | "thumbnailUrl" | "contentUrl" | "downloadUrl"
          );
        }

        if is_dep {
          let content = node.get_attribute(expanded_name!("", "content"));
          if let Some(content) = content {
            if !content.is_empty() {
              let placeholder = self.add_dep(
                content,
                needs_stable_name,
                Priority::Lazy,
                node.line,
                Some(UrlReference::Document),
              );
              node.set_attribute(expanded_name!("", "content"), &placeholder);
            }
          }
        }
      }
      expanded_name!(html "img") | expanded_name!(html "source") => {
        self.handle_document_attr(node, expanded_name!("", "src"), false);
        self.handle_srcset(node, expanded_name!("", "srcset"), node.line);
      }
      expanded_name!(html "audio")
      | expanded_name!(html "track")
      | expanded_name!(html "embed") => {
        self.handle_document_attr(node, expanded_name!("", "src"), false);
      }
      expanded_name!(html "video") => {
        self.handle_document_attr(node, expanded_name!("", "src"), false);
        self.handle_document_attr(node, expanded_name!("", "poster"), false);
      }
      expanded_name!(html "iframe") => {
        self.handle_document_attr(node, expanded_name!("", "src"), true);
      }
      expanded_name!(html "object") => {
        self.handle_document_attr(node, expanded_name!("", "data"), false);
      }
      expanded_name!(html "a") => {
        if let Some(href) = node.get_attribute(expanded_name!("", "href")) {
          // Check for id references
          if href.is_empty() || href.starts_with('#') {
            return;
          }

          // Check for virtual paths
          let path = href.split_once('#').map_or(href.as_ref(), |p| p.0);
          if path.rfind('.').unwrap_or(0) < 1 {
            return;
          }

          let placeholder = self.add_dep(
            href,
            true,
            Priority::Lazy,
            node.line,
            Some(UrlReference::Document),
          );
          node.set_attribute(expanded_name!("", "href"), &placeholder);
        }
      }
      // A list of all SVG elements that create a dependency
      // Based on https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute
      // See also https://www.w3.org/TR/SVG/attindex.html and https://www.w3.org/TR/SVG11/attindex.html
      // SVG animation elements are excluded because they may only reference elements in the same document: https://www.w3.org/TR/SVG/linking.html#processingURL-fetch
      expanded_name!(svg "a") => {
        self.handle_document_attr(node, expanded_name!("", "href"), true);
        self.handle_document_attr(node, expanded_name!(xlink "href"), true);
      }
      // These render an image, or an element of it (feImage).
      expanded_name!(svg "image") | expanded_name!(svg "feImage") => {
        self.handle_document_attr(node, expanded_name!("", "href"), false);
        self.handle_document_attr(node, expanded_name!(xlink "href"), false);
      }
      // These use the referenced element, e.g. a <symbol>, or inherit a gradient or pattern's
      // attributes and stops.
      expanded_name!(svg "use")
      | expanded_name!(svg "linearGradient")
      | expanded_name!(svg "radialGradient")
      | expanded_name!(svg "pattern")
      | expanded_name!(svg "mpath")
      | expanded_name!(svg "textPath") => {
        self.handle_element_attr(node, expanded_name!("", "href"));
        self.handle_element_attr(node, expanded_name!(xlink "href"));
      }
      expanded_name!(svg "altGlyph")
      | expanded_name!(svg "filter")
      | expanded_name!(svg "font-face-uri")
      | expanded_name!(svg "glyphRef")
      | expanded_name!(svg "tref") => {
        self.handle_element_attr(node, expanded_name!(xlink "href"));
      }
      expanded_name!(svg "cursor") | expanded_name!(svg "color-profile") => {
        self.handle_document_attr(node, expanded_name!(xlink "href"), false);
      }
      n if is_parcel_tag(&n, "include") || is_parcel_tag(&n, "layout") => {
        // <parcel:include src="..." /> adds an inline dependency on `src` which replaces it during packaging.
        if let Some(src) = node.get_attribute(expanded_name!("", "src")) {
          let mut dep = Dependency {
            specifier: src.to_string().into_boxed_str(),
            specifier_type: SpecifierType::Url,
            flags: DependencyFlags::empty(),
            priority: Default::default(),
            target: self.target.clone(),
            bundle_behavior: BundleBehavior::Inline,
            import_type: ImportType::Url,
            placeholder: Default::default(),
            loc: self.create_loc(node.line),
            resolve_from: Some(self.url.clone()),
            range: None,
            conditions: ExportsCondition::empty(),
            resolution: DependencyResolution::None,
            concurrent_group: 0,
            custom_conditions: Default::default(),
          };

          node.set_attribute(expanded_name!("", "src"), dep.set_placeholder());
          self.deps.push(dep);
        }
      }
      n if is_parcel_tag(&n, "define") => {
        // <parcel:define name="foo" src="foo.js#export"> defines an element named <foo> that calls the macro.
        if let (Some(name), Some(src)) = (
          node.get_attribute(expanded_name!("", "name")),
          node.get_attribute(expanded_name!("", "src")),
        ) {
          self.macro_imports.insert(name.to_string(), src.to_string());
          node.detach();
        }
      }
      n if is_parcel_tag(&n, "macro") => {
        // <parcel:macro src="foo.js#name" prop="value">content</parcel:macro> calls the `name` function
        // in foo.js, passing in "content" and `{prop: 'value'} as arguments.
        if let Some(src) = node.get_attribute(expanded_name!("", "src")) {
          let (script, export) = src.split_once('#').unwrap_or((&src, "default"));
          self.call_macro(script, export, node, false)
        }
      }
      n if matches!(*n.ns(), ns!() | ns!(html)) && !self.macro_imports.is_empty() => {
        let name = &**n.local_name();
        if let Some(src) = self.macro_imports.get(name) {
          if !self.expanding_imports.iter().any(|n| n == name) {
            let src = src.clone();
            let (script, export) = src.split_once('#').unwrap_or((&src, "default"));
            self.expanding_imports.push(name.to_owned());
            self.call_macro(script, export, node, true);
            self.expanding_imports.pop();
          }
        }
      }
      _ => {}
    }

    if let Some(style) = node.get_attribute(expanded_name!("", "style")) {
      let mut hash = DefaultHasher::new();
      style.hash(&mut hash);
      let key: StrTendril = format!("{:x}", hash.finish()).into();
      node.set_attribute(expanded_name!("", "style"), &key);

      self.assets.push(Asset {
        ty: AssetType::StyleAttribute,
        content: Arc::new(BufferContent::new_string(style.to_string())),
        unique_key: Some(key.to_string().into()),
        flags: AssetFlags::IS_HTML_ATTR,
        target: self.target.clone(),
        bundle_behavior: BundleBehavior::Inline,
        loc: self.create_loc(node.line).unwrap(),
        pipeline: None,
        dependencies: Vec::new(),
        symbols: AssetSymbols::default(),
      });
    }

    // Attributes that allow url() to reference another element, either in the same document or a different one.
    // https://www.w3.org/TR/SVG11/linking.html#processingIRI
    // SVG2 - https://www.w3.org/TR/SVG/linking.html#processingURL-validity
    if name.ns == ns!(svg) {
      if let NodeData::Element { attrs, .. } = &node.data {
        for attr in attrs.borrow_mut().iter_mut() {
          if is_func_iri_attr(&attr.name) && attr.value.starts_with("url(") {
            let mut input = cssparser::ParserInput::new(&attr.value);
            let mut parser = cssparser::Parser::new(&mut input);
            let placeholder = if let Ok(url) = parser.expect_url() {
              // Most of these paint with or apply the referenced element, e.g. a gradient or
              // mask, but cursors and images may be documents.
              let reference = if is_func_iri_image_attr(&attr.name) {
                UrlReference::Document
              } else {
                UrlReference::Element
              };
              Some(self.add_dep(
                url.as_ref().into(),
                false,
                Priority::Lazy,
                node.line,
                Some(reference),
              ))
            } else {
              None
            };
            drop(input);
            if let Some(placeholder) = placeholder {
              attr.value = placeholder;
            }
          }
        }
      }
    }
  }

  fn handle_text_url(&mut self, node: &'arena Node<'arena>) {
    let contents = node.text_content();
    let url = contents.trim();
    if !url.is_empty() && !url.starts_with('#') {
      let placeholder = self.add_dep(
        url.into(),
        true,
        Priority::Lazy,
        node.line,
        Some(UrlReference::Document),
      );
      node.set_text_content(self.arena, placeholder);
    }
  }

  fn handle_feed_attr(
    &mut self,
    node: &'arena Node<'arena>,
    name: ExpandedName,
    needs_stable_name: bool,
  ) {
    if node
      .get_attribute(name.clone())
      .is_some_and(|url| !url.is_empty())
    {
      self.handle_document_attr(node, name, needs_stable_name);
    }
  }

  /// Adds a dependency for a URL attribute whose target is rendered or navigated to.
  fn handle_document_attr(
    &mut self,
    node: &'arena Node<'arena>,
    name: ExpandedName,
    needs_stable_name: bool,
  ) {
    self.handle_attr(node, name, needs_stable_name, UrlReference::Document);
  }

  /// Adds a dependency for a URL attribute referencing an element of another document.
  fn handle_element_attr(&mut self, node: &'arena Node<'arena>, name: ExpandedName) {
    self.handle_attr(node, name, false, UrlReference::Element);
  }

  fn handle_attr(
    &mut self,
    node: &'arena Node<'arena>,
    name: ExpandedName,
    needs_stable_name: bool,
    reference: UrlReference,
  ) {
    let line = node.line;
    let src = node.get_attribute(name.clone());
    if let Some(src) = src {
      // Check for empty string
      if src.is_empty() {
        self.add_diagnostic(
          &format!("'{}' should not be empty string", name.local),
          line,
        );
        return;
      }

      // Check for id references
      if src.starts_with('#') {
        return;
      }

      let placeholder = self.add_dep(
        src,
        needs_stable_name,
        Priority::Lazy,
        line,
        Some(reference),
      );
      node.set_attribute(name, &placeholder);
    }
  }

  fn handle_srcset(&mut self, node: &'arena Node<'arena>, name: ExpandedName, line: u32) {
    let srcset = node.get_attribute(name.clone());
    if let Some(srcset) = srcset {
      let mut srcset = parse_srcset(srcset.as_ref());
      for img in &mut srcset {
        let mut dep = Dependency {
          specifier: img.url.clone().into(),
          specifier_type: SpecifierType::Url,
          priority: Priority::Lazy,
          target: self.target.clone(),
          flags: DependencyFlags::empty(),
          bundle_behavior: BundleBehavior::None,
          import_type: ImportType::Url,
          placeholder: None,
          loc: self.create_loc(line),
          resolve_from: Some(self.url.clone()),
          range: None,
          conditions: ExportsCondition::empty(),
          resolution: DependencyResolution::None,
          concurrent_group: 0,
          custom_conditions: Default::default(),
        };

        img.url = dep.set_placeholder().into();
        self.push_dep(dep, Some(UrlReference::Document));
      }

      node.set_attribute(name, &serialize_srcset(srcset));
    }
  }

  /// Adds a URL dependency, returning its placeholder. `reference` describes how the target is
  /// used, which decides the symbols imported from SVG documents. None imports nothing, so an
  /// SVG keeps everything.
  fn add_dep(
    &mut self,
    src: StrTendril,
    needs_stable_name: bool,
    priority: Priority,
    line: u32,
    reference: Option<UrlReference>,
  ) -> StrTendril {
    let mut dep = Dependency {
      specifier: src.to_string().into(),
      specifier_type: SpecifierType::Url,
      priority,
      target: self.target.clone(),
      flags: {
        let mut flags = DependencyFlags::empty();
        flags.set(DependencyFlags::NEEDS_STABLE_NAME, needs_stable_name);
        flags
      },
      bundle_behavior: BundleBehavior::None,
      import_type: ImportType::Url,
      placeholder: Default::default(),
      loc: self.create_loc(line),
      range: None,
      resolve_from: Some(self.url.clone()),
      conditions: ExportsCondition::empty(),
      resolution: DependencyResolution::None,
      concurrent_group: 0,
      custom_conditions: Default::default(),
    };

    let placeholder = dep.set_placeholder().into();
    self.push_dep(dep, reference);
    placeholder
  }

  fn push_dep(&mut self, dep: Dependency, reference: Option<UrlReference>) {
    if let Some(reference) = reference {
      let dep_index = self.deps.len() as u32;
      for symbol in dep.url_reference_symbols(reference) {
        self.imports.push(ImportedSymbol {
          dep_index,
          symbol,
          resolved: SymbolResolution::None,
          owners: Vec::new(),
        });
      }
    }
    self.deps.push(dep);
  }

  fn call_macro(
    &mut self,
    script: &str,
    export: &str,
    node: &'arena Node<'arena>,
    allow_src: bool,
  ) {
    use parcel_macros::{JsValue, MacroError};

    let mut props = indexmap::IndexMap::new();
    if let NodeData::Element { attrs, .. } = &node.data {
      for attr in attrs.borrow_mut().iter_mut() {
        if !allow_src && &attr.name.local == "src" {
          continue;
        }
        props.insert(
          attr.name.local.to_string(),
          JsValue::String(attr.value.to_string()),
        );
      }
    }

    // XML documents (feeds, SVG) are parsed and serialized as XML, so macros can produce
    // namespaced elements.
    let xml = self.ty != AssetType::Html;
    let mut content = Vec::new();
    if xml {
      let mut child = node.first_child.get();
      while let Some(c) = child {
        let _ = crate::serialize_xml::serialize(&mut content, c);
        child = c.next_sibling.get();
      }
    } else {
      let _ = html5ever::serialize::serialize(
        &mut content,
        &SerializableHandle(node),
        Default::default(),
      );
    }

    match parcel_plugin_js::call_macro(
      self.options,
      self.url.clone(),
      self.target.clone(),
      self
        .url
        .join(script)
        .to_file_path()
        .unwrap()
        .to_path_buf()
        .to_str()
        .unwrap()
        .to_string(),
      export.to_owned(),
      vec![
        JsValue::String(String::from_utf8(content).unwrap()),
        JsValue::Object(props),
      ],
      parcel_macros::Location {
        line: node.line,
        col: 1,
      },
    ) {
      Ok((JsValue::String(result), _deps)) => {
        let root = if xml {
          match parse_xml_fragment(&self.arena, node, &result) {
            Some(root) => {
              if self.ty == AssetType::Xml {
                let embedded = expand_html_in(&self.arena, root, self.rss);
                self.embedded.extend(embedded);
              }
              root
            }
            None => {
              self.add_diagnostic("HTML macro returned invalid XML", node.line);
              return;
            }
          }
        } else {
          let fragment = html5ever::driver::parse_fragment(
            Sink::new(&self.arena),
            html5ever::ParseOpts::default(),
            xml5ever::QualName::new(None, ns!(html), local_name!("div")),
            Vec::new(),
          )
          .one(result);
          // html5ever places fragment children under a synthetic HTML root.
          fragment.first_child.get().unwrap()
        };
        if self
          .root
          .is_some_and(|dom| crate::head::can_hoist_from(node, dom))
        {
          crate::head::collect_hoistable(root, &mut self.hoisted);
        }
        let mut output = Vec::new();
        while let Some(child) = root.first_child.get() {
          node.insert_before(child);
          output.push(child);
        }
        node.detach();
        // The macro's content was replaced by its output, so it shouldn't be walked.
        while let Some(child) = node.first_child.get() {
          child.detach();
        }
        // Collect dependencies (and call nested macros) in the output.
        for child in output {
          self.walk(child);
        }
      }
      Err(err) => {
        let message = match err {
          MacroError::LoadError(ref err, _) | MacroError::ExecutionError(ref err, _) => {
            err.as_str()
          }
          _ => "Error running macro",
        };
        self.add_diagnostic(message, node.line);
      }
      Ok(_) => {
        self.add_diagnostic("HTML macros must return strings", node.line);
      }
    }
  }
}

/// Splits the `content` of `<meta http-equiv="refresh">` into the delay and URL, if it has one.
/// https://html.spec.whatwg.org/multipage/semantics.html#shared-declarative-refresh-steps
fn parse_refresh(content: &str) -> Option<(&str, &str)> {
  let content = content.trim_start();
  let delay_end = content
    .find(|c: char| !c.is_ascii_digit() && c != '.')
    .unwrap_or(content.len());
  let (delay, rest) = content.split_at(delay_end);
  if delay.is_empty() {
    return None;
  }
  let rest = rest.trim_start_matches(|c: char| c.is_ascii_whitespace() || c == ';' || c == ',');
  let rest = if rest.len() >= 3 && rest[..3].eq_ignore_ascii_case("url") {
    rest[3..].trim_start().strip_prefix('=')?.trim_start()
  } else {
    rest
  };
  let url = match rest.chars().next() {
    Some(quote @ ('\'' | '"')) => rest[1..].split(quote).next().unwrap_or(""),
    _ => rest.trim_end(),
  };
  if url.is_empty() {
    None
  } else {
    Some((delay, url))
  }
}

/// Parses XML in the context of `context`, so it inherits the namespace declarations in scope
/// there (e.g. the default Atom namespace of a feed). Returns an element containing the result.
fn parse_xml_fragment<'arena>(
  arena: &'arena Arena<Node<'arena>>,
  context: &'arena Node<'arena>,
  xml: &str,
) -> Option<&'arena Node<'arena>> {
  let mut ancestors = Vec::new();
  let mut parent = context.parent.get();
  while let Some(p) = parent {
    ancestors.push(p);
    parent = p.parent.get();
  }
  // Outermost first, so inner declarations override outer ones.
  let mut declarations = indexmap::IndexMap::new();
  for ancestor in ancestors.iter().rev() {
    if let NodeData::Element { attrs, .. } = &ancestor.data {
      for attr in attrs.borrow().iter() {
        let name = match (&attr.name.prefix, attr.name.local.as_ref()) {
          (Some(prefix), local) if prefix.as_ref() == "xmlns" => format!("xmlns:{}", local),
          (None, "xmlns") => "xmlns".to_string(),
          _ => continue,
        };
        declarations.insert(name, attr.value.to_string());
      }
    }
  }

  let mut wrapper = String::from("<parcel-macro-output");
  for (name, value) in &declarations {
    wrapper.push_str(&format!(
      " {}=\"{}\"",
      name,
      value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
    ));
  }
  wrapper.push('>');
  wrapper.push_str(xml);
  wrapper.push_str("</parcel-macro-output>");

  let dom = xml5ever::driver::parse_document(Sink::new(arena), Default::default())
    .from_utf8()
    .one(wrapper.as_bytes());
  let mut child = dom.first_child.get();
  while let Some(c) = child {
    if let NodeData::Element { name, .. } = &c.data {
      if name.local.as_ref() == "parcel-macro-output" {
        return Some(c);
      }
    }
    child = c.next_sibling.get();
  }
  None
}

/// Whether a presentation attribute's `url()` may reference an image rather than an element.
fn is_func_iri_image_attr(name: &QualName) -> bool {
  match name.expanded() {
    expanded_name!("", "cursor") | expanded_name!("", "color-profile") => true,
    name => matches!(
      name.local.as_ref(),
      "shape-inside" | "shape-subtract" | "mask-image"
    ),
  }
}

pub fn is_func_iri_attr(name: &QualName) -> bool {
  match name.expanded() {
    expanded_name!("", "fill")
    | expanded_name!("", "stroke")
    | expanded_name!("", "clip-path")
    | expanded_name!("", "color-profile")
    | expanded_name!("", "cursor")
    | expanded_name!("", "filter")
    | expanded_name!("", "marker")
    | expanded_name!("", "marker-start")
    | expanded_name!("", "marker-mid")
    | expanded_name!("", "marker-end")
    | expanded_name!("", "mask") => true,
    name => {
      let local = name.local.as_ref();
      local == "shape-inside" || local == "shape-subtract" || local == "mask-image"
    }
  }
}

/// Parses an <?xml-stylesheet ?> processing instruction.
/// https://www.w3.org/TR/xml-stylesheet/
pub fn parse_xml_stylesheet(contents: &str) -> Result<Vec<Attribute>, Cow<'static, str>> {
  use xml5ever::{buffer_queue::*, tokenizer::*};

  struct Sink(RefCell<Result<Vec<Attribute>, Cow<'static, str>>>);
  impl TokenSink for Sink {
    fn process_token(&self, token: Token) {
      match token {
        Token::TagToken(tag) => {
          *self.0.borrow_mut() = Ok(tag.attrs);
        }
        Token::ParseError(err) => {
          *self.0.borrow_mut() = Err(err);
        }
        _ => {}
      }
    }
  }

  let sink = Sink(RefCell::new(Err(Cow::Borrowed("Invalid xml-stylesheet"))));
  let tokenizer = XmlTokenizer::new(sink, Default::default());

  let mut buf = BufferQueue::default();
  buf.push_back(format_tendril!("<xml-stylesheet {} />", contents));
  tokenizer.run(&mut buf);

  tokenizer.sink.0.into_inner()
}

pub fn serialize_xml_stylesheet(attrs: Vec<Attribute>) -> StrTendril {
  let mut s = StrTendril::new();

  let mut first = true;
  for attr in attrs {
    if first {
      first = false;
    } else {
      s.push_char(' ');
    }

    if let Some(ref prefix) = attr.name.prefix {
      s.push_slice(prefix.as_ref());
      s.push_char(':');
    }
    s.push_slice(attr.name.local.as_ref());
    s.push_char('=');
    s.push_char('"');
    for c in attr.value.chars() {
      match c {
        '&' => s.push_slice("&amp;"),
        '\'' => s.push_slice("&apos;"),
        '"' => s.push_slice("&quot;"),
        c => s.push_char(c),
      }
    }
    s.push_char('"');
  }

  s
}

#[inline]
pub fn is_parcel_tag(n: &ExpandedName, name: &str) -> bool {
  (n.ns() == &ns!(html) && is_parcel_html_tag(n.local_name(), name))
    || (n.ns() == "http://parceljs.org" && n.local_name() == name)
}

#[inline]
fn is_parcel_html_tag(local: &LocalName, name: &str) -> bool {
  local.starts_with("parcel:") && &local[7..] == name
}
