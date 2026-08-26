use std::borrow::{Borrow, Cow};
use std::cell::RefCell;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::Arc;

use crate::arena::{Node, NodeData};
use crate::srcset::{parse_srcset, serialize_srcset};
use html5ever::tendril::{StrTendril, format_tendril};
use html5ever::{Attribute, ExpandedName, QualName, expanded_name, local_name, namespace_url, ns};
use parcel_core::{
  Asset, AssetFlags, AssetRequest, AssetSymbols, AssetType, BufferContent, BundleBehavior,
  CodeFrame, CodeHighlight, Dependency, DependencyFlags, DependencyResolution, Diagnostic,
  DiagnosticSeverity, EnvironmentFeature, ExportsCondition, Location, OutputFormat, Priority,
  SourceLocation, SourceType, SourceUrl, SpecifierType, Target,
};
use typed_arena::Arena;

pub fn collect_dependencies<'arena>(
  arena: &'arena Arena<Node<'arena>>,
  dom: &'arena Node<'arena>,
  url: SourceUrl,
  ty: AssetType,
  target: Arc<Target>,
  hmr: bool,
) -> (Vec<Dependency>, Vec<Asset>, Vec<Diagnostic>) {
  let mut collector = DependencyCollector::new(arena, url, ty, target);

  dom.walk(&mut |node| match &node.data {
    NodeData::Element { name, .. } => {
      collector.visit_element(node, name);
    }
    NodeData::ProcessingInstruction { target, contents } => {
      let mut contents = contents.borrow_mut();
      if target.as_ref() == "xml-stylesheet" {
        if let Ok(mut attrs) = parse_xml_stylesheet(contents.borrow().as_ref()) {
          for attr in &mut attrs {
            if attr.name.expanded() == expanded_name!("", "href") {
              attr.value =
                collector.add_dep(attr.value.clone(), false, Priority::Parallel, node.line);
            }
          }

          *contents = serialize_xml_stylesheet(attrs);
        }
      }
    }
    _ => {}
  });

  for asset in &collector.assets {
    collector.deps.push(Dependency {
      specifier: asset.unique_key.clone().unwrap(),
      specifier_type: SpecifierType::Esm,
      flags: DependencyFlags::empty(),
      priority: Priority::Sync,
      target: asset.target.clone(),
      bundle_behavior: BundleBehavior::Inline,
      placeholder: asset.unique_key.clone(),
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
    });
  }

  if hmr && !collector.has_module_scripts {
    if let Some(body) = dom.find(expanded_name!(html "body")) {
      let key: StrTendril = "hmr.js".into();
      let src = collector.add_dep(key.clone(), false, Priority::Parallel, 0);
      collector.assets.push(Asset {
        ty: AssetType::Js,
        content: Arc::new(BufferContent::new(Vec::new())),
        unique_key: Some(key.into()),
        flags: AssetFlags::empty(),
        target: collector.target.clone(),
        bundle_behavior: BundleBehavior::None,
        loc: SourceLocation {
          url: collector.url.clone(),
          start: Default::default(),
          end: Default::default(),
        },
        pipeline: None,
        dependencies: Vec::new(),
        symbols: AssetSymbols::default(),
      });

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

  (collector.deps, collector.assets, collector.errors)
}

struct DependencyCollector<'arena> {
  arena: &'arena Arena<Node<'arena>>,
  url: SourceUrl,
  ty: AssetType,
  target: Arc<Target>,
  deps: Vec<Dependency>,
  assets: Vec<Asset>,
  key: u32,
  has_module_scripts: bool,
  errors: Vec<Diagnostic>,
}

impl<'arena> DependencyCollector<'arena> {
  fn new(
    arena: &'arena Arena<Node<'arena>>,
    url: SourceUrl,
    ty: AssetType,
    target: Arc<Target>,
  ) -> Self {
    DependencyCollector {
      arena,
      url,
      ty,
      target,
      deps: Vec::new(),
      assets: Vec::new(),
      key: 0,
      has_module_scripts: false,
      errors: Vec::new(),
    }
  }

  fn create_env(
    &self,
    output_format: OutputFormat,
    source_type: SourceType,
    line: u32,
  ) -> Arc<Target> {
    Arc::new(Target {
      output_format,
      source_type,
      loc: self.create_loc(line),
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
          if let Some(rel) = node.get_attribute(expanded_name!("", "rel")) {
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
            } else if rel.as_ref() == "alternate" {
              if let Some(t) = node.get_attribute(expanded_name!("", "type")) {
                if t.as_ref() == "application/rss+xml" || t.as_ref() == "application/atom+xml" {
                  flags |= DependencyFlags::NEEDS_STABLE_NAME;
                }
              }
            }
          }

          let mut dep = Dependency {
            specifier: href.into(),
            specifier_type: SpecifierType::Url,
            flags,
            priority,
            target: self.target.clone(),
            bundle_behavior: BundleBehavior::None,
            placeholder: Default::default(),
            loc: self.create_loc(node.line),
            resolve_from: Some(self.url.clone()),
            range: None,
            conditions: ExportsCondition::empty(),
            resolution: DependencyResolution::None,
          };

          node.set_attribute(expanded_name!("", "href"), dep.set_placeholder());
          self.deps.push(dep);
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
            && (self.target.should_scope_hoist()
              || self.target.engines.supports(EnvironmentFeature::Esmodules))
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
          // Also, don't share dependencies between classic scripts and nomodule scripts
          // because nomodule scripts won't run when modules are supported.
          let mut bundle_behavior = BundleBehavior::None;
          if source_type == SourceType::Script
            || node.get_attribute(expanded_name!("", "async")).is_some()
          {
            bundle_behavior = BundleBehavior::Isolated;
          }

          // If this is a <script type="module">, and not all of the browser targets support ESM natively,
          // add a copy of the script tag with a nomodule attribute.
          if output_format == OutputFormat::Esmodule
            && !self.target.engines.supports(EnvironmentFeature::Esmodules)
          {
            let copy = self.arena.alloc(Node::new(node.data.clone(), node.line));
            copy.remove_attribute(expanded_name!("", "type"));
            copy.set_attribute(expanded_name!("", "nomodule"), "");
            copy.set_attribute(expanded_name!("", "defer"), "");

            let mut dep = Dependency {
              specifier: src.clone().into(),
              specifier_type: SpecifierType::Url,
              priority: Priority::Parallel,
              target: self.create_env(OutputFormat::Global, source_type, node.line),
              flags: DependencyFlags::empty(),
              bundle_behavior,
              placeholder: Default::default(),
              loc: self.create_loc(node.line),
              resolve_from: Some(self.url.clone()),
              range: None,
              conditions: ExportsCondition::empty(),
              resolution: DependencyResolution::None,
            };

            copy.set_attribute(src_attr, dep.set_placeholder());
            self.deps.push(dep);
            node.insert_before(copy);
          }

          let mut dep = Dependency {
            specifier: src.into(),
            specifier_type: SpecifierType::Url,
            priority: Priority::Parallel,
            target: self.create_env(output_format, source_type, node.line),
            flags: DependencyFlags::empty(),
            bundle_behavior,
            placeholder: Default::default(),
            loc: self.create_loc(node.line),
            resolve_from: Some(self.url.clone()),
            range: None,
            conditions: ExportsCondition::empty(),
            resolution: DependencyResolution::None,
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
            if self.target.should_scope_hoist()
              && self.target.engines.supports(EnvironmentFeature::Esmodules)
              && !is_svg
            {
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
            unique_key: Some(key.into()),
            flags: AssetFlags::IS_HTML_TAG,
            target: self.create_env(output_format, source_type, node.line),
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
          unique_key: Some(key.into()),
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
        if let Some(property) = node.get_attribute(expanded_name!("", "property")) {
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
              let placeholder = self.add_dep(content, needs_stable_name, Priority::Lazy, node.line);
              node.set_attribute(expanded_name!("", "content"), &placeholder);
            }
          }
        }
      }
      expanded_name!(html "img") | expanded_name!(html "source") => {
        self.handle_attr(node, expanded_name!("", "src"), false, node.line);
        self.handle_srcset(node, expanded_name!("", "srcset"), node.line);
      }
      expanded_name!(html "audio")
      | expanded_name!(html "track")
      | expanded_name!(html "embed") => {
        self.handle_attr(node, expanded_name!("", "src"), false, node.line);
      }
      expanded_name!(html "video") => {
        self.handle_attr(node, expanded_name!("", "src"), false, node.line);
        self.handle_attr(node, expanded_name!("", "poster"), false, node.line);
      }
      expanded_name!(html "iframe") => {
        self.handle_attr(node, expanded_name!("", "src"), true, node.line);
      }
      expanded_name!(html "object") => {
        self.handle_attr(node, expanded_name!("", "data"), false, node.line);
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

          let placeholder = self.add_dep(href, true, Priority::Lazy, node.line);
          node.set_attribute(expanded_name!("", "href"), &placeholder);
        }
      }
      // A list of all SVG elements that create a dependency
      // Based on https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute
      // See also https://www.w3.org/TR/SVG/attindex.html and https://www.w3.org/TR/SVG11/attindex.html
      // SVG animation elements are excluded because they may only reference elements in the same document: https://www.w3.org/TR/SVG/linking.html#processingURL-fetch
      expanded_name!(svg "a") => {
        self.handle_attr(node, expanded_name!("", "href"), true, node.line);
        self.handle_attr(node, expanded_name!(xlink "href"), true, node.line);
      }
      expanded_name!(svg "use")
      | expanded_name!(svg "image")
      | expanded_name!(svg "feImage")
      | expanded_name!(svg "linearGradient")
      | expanded_name!(svg "radialGradient")
      | expanded_name!(svg "pattern")
      | expanded_name!(svg "mpath")
      | expanded_name!(svg "textPath") => {
        self.handle_attr(node, expanded_name!("", "href"), false, node.line);
        self.handle_attr(node, expanded_name!(xlink "href"), false, node.line);
      }
      expanded_name!(svg "altGlyph")
      | expanded_name!(svg "cursor")
      | expanded_name!(svg "filter")
      | expanded_name!(svg "font-face-uri")
      | expanded_name!(svg "glyphRef")
      | expanded_name!(svg "tref")
      | expanded_name!(svg "color-profile") => {
        self.handle_attr(node, expanded_name!(xlink "href"), false, node.line);
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
        unique_key: Some(key.into()),
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
              Some(self.add_dep(url.as_ref().into(), false, Priority::Lazy, node.line))
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

  fn handle_attr(
    &mut self,
    node: &'arena Node<'arena>,
    name: ExpandedName,
    needs_stable_name: bool,
    line: u32,
  ) {
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

      let placeholder = self.add_dep(src, needs_stable_name, Priority::Lazy, line);
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
          placeholder: None,
          loc: self.create_loc(line),
          resolve_from: Some(self.url.clone()),
          range: None,
          conditions: ExportsCondition::empty(),
          resolution: DependencyResolution::None,
        };

        img.url = dep.set_placeholder().into();
        self.deps.push(dep);
      }

      node.set_attribute(name, &serialize_srcset(srcset));
    }
  }

  fn add_dep(
    &mut self,
    src: StrTendril,
    needs_stable_name: bool,
    priority: Priority,
    line: u32,
  ) -> StrTendril {
    let mut dep = Dependency {
      specifier: src.into(),
      specifier_type: SpecifierType::Url,
      priority,
      target: self.target.clone(),
      flags: {
        let mut flags = DependencyFlags::empty();
        flags.set(DependencyFlags::NEEDS_STABLE_NAME, needs_stable_name);
        flags
      },
      bundle_behavior: BundleBehavior::None,
      placeholder: Default::default(),
      loc: self.create_loc(line),
      range: None,
      resolve_from: Some(self.url.clone()),
      conditions: ExportsCondition::empty(),
      resolution: DependencyResolution::None,
    };

    let placeholder = dep.set_placeholder().into();
    self.deps.push(dep);
    placeholder
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
