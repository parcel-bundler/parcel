use std::{collections::HashMap, sync::Arc};

use html5ever::tendril::TendrilSink;
use html5ever::{QualName, expanded_name, local_name, namespace_url, ns};
use parcel_core::*;
use typed_arena::Arena;

use crate::{
  InlineBundle, SerializableTendril, TransformOptions, TransformResult,
  arena::{Node, NodeData, Ref, SerializableHandle, Sink},
  dependencies::collect_dependencies,
  optimize::{OptimizeOptions, optimize},
  package::insert_bundle_references,
  prepare_to_package, prepare_to_package_dependencies, serialize_xml,
};

pub(crate) const ATOM_NS: &str = "http://www.w3.org/2005/Atom";

pub(crate) fn is_rss(dom: Ref<'_>) -> bool {
  let mut child = dom.first_child.get();
  while let Some(node) = child {
    if let NodeData::Element { name, .. } = &node.data {
      return name.ns.is_empty() && name.local.as_ref() == "rss";
    }
    child = node.next_sibling.get();
  }
  false
}

struct EmbeddedContent<'arena> {
  node: Ref<'arena>,
  escaped: bool,
}

/// Escaped HTML becomes a temporary subtree, allowing the same collector and
/// packager to visit it as XHTML. It never becomes a separate HTML asset.
fn expand_html<'arena>(
  arena: &'arena Arena<Node<'arena>>,
  dom: Ref<'arena>,
) -> Vec<EmbeddedContent<'arena>> {
  let rss = is_rss(dom);
  let mut embedded = Vec::new();
  dom.walk(&mut |node| {
    if let NodeData::Element { name, .. } = &node.data {
      let escaped = if rss && name.ns.is_empty() && name.local.as_ref() == "description" {
        true
      } else if name.ns.as_ref() == ATOM_NS && name.local.as_ref() == "content" {
        match node.get_attribute(expanded_name!("", "type")).as_deref() {
          Some("html") => true,
          Some("xhtml") => false,
          _ => return,
        }
      } else {
        return;
      };
      embedded.push(EmbeddedContent { node, escaped });
    }
  });

  for content in &embedded {
    if !content.escaped {
      continue;
    }
    let fragment = html5ever::driver::parse_fragment(
      Sink::new(arena),
      Default::default(),
      QualName::new(None, ns!(html), local_name!("div")),
      Vec::new(),
    )
    .one(content.node.text_content());
    // html5ever places fragment children under a synthetic HTML root.
    let root = fragment.first_child.get().unwrap();
    while let Some(child) = content.node.first_child.get() {
      child.detach();
    }
    while let Some(child) = root.first_child.get() {
      content.node.append(child);
    }
  }
  embedded
}

fn collapse_html<'arena>(
  arena: &'arena Arena<Node<'arena>>,
  embedded: &[EmbeddedContent<'arena>],
) -> Result<(), Diagnostic> {
  for content in embedded {
    if content.escaped {
      let mut code = Vec::new();
      html5ever::serialize::serialize(
        &mut code,
        &SerializableHandle(content.node),
        Default::default(),
      )?;
      content
        .node
        .set_text_content(arena, String::from_utf8(code).unwrap().into());
    }
  }
  Ok(())
}

pub fn transform_xml(options: TransformOptions) -> TransformResult {
  let arena = Arena::new();
  let dom = xml5ever::driver::parse_document(Sink::new(&arena), Default::default())
    .from_utf8()
    .one(options.code.as_slice());
  let embedded = expand_html(&arena, dom);
  let (dependencies, assets, mut errors) = collect_dependencies(
    &arena,
    dom,
    options.url,
    AssetType::Xml,
    options.target,
    false,
  );
  if let Err(err) = collapse_html(&arena, &embedded) {
    errors.push(err);
  }
  let mut code = Vec::new();
  if let Err(err) = serialize_xml::serialize(&mut code, dom) {
    errors.push(err.into());
  }
  TransformResult {
    code,
    dependencies,
    assets,
    errors,
  }
}

pub struct XmlTransformer {}

impl Transformer for XmlTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    _options: &ParcelOptions,
    _fs: &Arc<dyn FileSystem>,
  ) -> Result<Asset, DiagnosticList> {
    let result = transform_xml(TransformOptions {
      code: asset.content.read()?,
      url: asset.loc.url.clone(),
      xml: true,
      target: asset.target.clone(),
      hmr: false,
    });
    if !result.errors.is_empty() {
      return Err(DiagnosticList(result.errors));
    }
    asset.bundle_behavior = BundleBehavior::Isolated;
    asset.dependencies.extend(result.dependencies);
    asset.content = Arc::new(XmlContent {
      code: result.code,
      url: asset.loc.url.clone(),
    });
    Ok(asset)
  }
}

struct XmlContent {
  code: Vec<u8>,
  url: SourceUrl,
}

impl Content for XmlContent {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    Ok(self.code.clone())
  }

  fn estimate_size(&self) -> Result<usize, Diagnostic> {
    Ok(self.code.len())
  }

  fn ty(&self) -> ContentType {
    parcel_core::content_type!("XmlContent")
  }

  fn bundle_dependencies(&self, graph: &BundleGraph, bundle: &Bundle) -> Vec<usize> {
    prepare_to_package_dependencies(graph, bundle)
  }

  fn package(
    &self,
    graph: &BundleGraph,
    bundle: &Bundle,
    get_inline: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    let (code, bundles, inline_bundles, stylesheet_media, element_refs) =
      prepare_to_package(graph, bundle, get_inline)?;
    let arena = Arena::new();
    let dom = xml5ever::driver::parse_document(Sink::new(&arena), Default::default())
      .from_utf8()
      .one(code.as_slice());
    let embedded = expand_html(&arena, dom);

    let reference_scopes: Vec<_> = embedded.iter().map(|content| content.node).collect();
    replace_text_urls(&arena, dom, &inline_bundles);
    insert_bundle_references(
      &arena,
      dom,
      bundles,
      inline_bundles,
      &stylesheet_media,
      &element_refs,
      &reference_scopes,
      Default::default(),
      None,
    );
    if bundle
      .target
      .flags
      .contains(EnvironmentFlags::SHOULD_OPTIMIZE)
    {
      for content in &embedded {
        optimize(
          &arena,
          content.node,
          OptimizeOptions::default(),
          &self.url.stable_id(&options.project_root),
        );
      }
    }
    collapse_html(&arena, &embedded)?;
    let mut code = Vec::new();
    serialize_xml::serialize(&mut code, dom).map_err(Diagnostic::from)?;
    Ok(Arc::new(BufferContent::new(code)))
  }
}

fn replace_text_urls<'arena>(
  arena: &'arena Arena<Node<'arena>>,
  dom: Ref<'arena>,
  replacements: &HashMap<SerializableTendril, InlineBundle>,
) {
  let rss = is_rss(dom);
  dom.walk(&mut |node| {
    if let NodeData::Element { name, .. } = &node.data {
      let text_url =
        (rss && name.ns.is_empty() && matches!(name.local.as_ref(), "link" | "url" | "comments"))
          || (name.ns.as_ref() == ATOM_NS && matches!(name.local.as_ref(), "icon" | "logo"));
      if text_url {
        if let Some(bundle) = replacements.get(&SerializableTendril(node.text_content().into())) {
          node.set_text_content(arena, bundle.contents.0.clone());
        }
      }
    }
  });
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::collections::HashSet;

  fn transform(code: &str) -> TransformResult {
    let result = transform_xml(TransformOptions {
      code: code.as_bytes().to_vec(),
      url: SourceUrl::parse("file:///feed.xml").unwrap(),
      xml: true,
      target: Default::default(),
      hmr: false,
    });
    assert!(result.errors.is_empty());
    result
  }

  #[test]
  fn feed_urls_use_namespace_and_root_context() {
    let result = transform(
      r#"<rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:other="urn:other"><channel>
      <link> post.html </link><image><url>icon.png</url></image>
      <comments>comments.html</comments><enclosure url="audio.mp3"/>
      <atom:link href="atom.html"/><atom:icon>atom.png</atom:icon><atom:logo>logo.png</atom:logo>
      <other:link href="missing.html"/><atom:id>identifier.html</atom:id>
      <guid>identifier.html</guid><other:description>&lt;img src="missing.png"&gt;</other:description>
    </channel></rss>"#,
    );
    let urls: Vec<_> = result
      .dependencies
      .iter()
      .map(|dep| {
        (
          dep.specifier.as_ref(),
          dep.flags.contains(DependencyFlags::NEEDS_STABLE_NAME),
        )
      })
      .collect();
    assert_eq!(
      urls,
      vec![
        ("post.html", true),
        ("icon.png", true),
        ("comments.html", true),
        ("audio.mp3", false),
        ("atom.html", true),
        ("atom.png", true),
        ("logo.png", true)
      ]
    );
    assert!(result.assets.is_empty());
    let code = String::from_utf8(result.code).unwrap();
    assert!(code.contains("<other:link href=\"missing.html\"/>"));
    assert!(code.contains("<atom:id>identifier.html</atom:id>"));
    let unknown = transform(
      r#"<document><link>post.html</link><description>&lt;img src="missing.png"&gt;</description><custom style="background:url(missing.png)"/></document>"#,
    );
    assert!(unknown.dependencies.is_empty());
    assert!(unknown.assets.is_empty());
  }

  #[test]
  fn html_fragments_share_the_collector_and_only_extract_other_languages() {
    let result = transform(
      r#"<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <content type="html">&lt;img src="one.png"&gt;&lt;script&gt;console.log(1)&lt;/script&gt;</content>
      <content type="html"><![CDATA[<img src="two.png"><script>console.log(2)</script><style>p { color: red }</style>]]></content>
      <content type="text">&lt;img src="missing.png"&gt;</content>
    </entry></feed>"#,
    );
    assert_eq!(
      result
        .assets
        .iter()
        .map(|asset| asset.ty.clone())
        .collect::<Vec<_>>(),
      vec![AssetType::Js, AssetType::Js, AssetType::Css]
    );
    assert_eq!(
      result
        .assets
        .iter()
        .map(|asset| asset.unique_key.as_ref().unwrap())
        .collect::<HashSet<_>>()
        .len(),
      3
    );
    assert_eq!(
      result
        .dependencies
        .iter()
        .filter(|dep| dep.specifier_type == SpecifierType::Url)
        .map(|dep| dep.specifier.as_ref())
        .collect::<Vec<_>>(),
      vec!["one.png", "two.png"]
    );
    let code = String::from_utf8(result.code).unwrap();
    assert!(!code.contains("&lt;html"));
    assert!(!code.contains("&lt;body"));
  }

  #[test]
  fn packaging_escapes_html_text_and_keeps_xhtml_as_nodes() {
    let result = transform(
      r#"<rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:x="http://www.w3.org/1999/xhtml"><channel>
      <link>post.html</link>
      <description><![CDATA[A &amp; B<img src="image.png">]]></description>
      <atom:content type="xhtml"><x:div><x:img src="image.png"/></x:div></atom:content>
    </channel></rss>"#,
    );
    let arena = Arena::new();
    let dom = xml5ever::driver::parse_document(Sink::new(&arena), Default::default())
      .from_utf8()
      .one(result.code.as_slice());
    let embedded = expand_html(&arena, dom);
    let replacements = result
      .dependencies
      .into_iter()
      .map(|dep| {
        (
          SerializableTendril(dep.placeholder.unwrap().to_string().into()),
          InlineBundle {
            contents: SerializableTendril(
              format!("https://example.org/{}?a=1&b=2", dep.specifier).into(),
            ),
            module: false,
          },
        )
      })
      .collect();
    replace_text_urls(&arena, dom, &replacements);
    insert_bundle_references(
      &arena,
      dom,
      Vec::new(),
      replacements,
      &Default::default(),
      &Default::default(),
      &[],
      Default::default(),
      None,
    );
    collapse_html(&arena, &embedded).unwrap();
    let mut code = Vec::new();
    serialize_xml::serialize(&mut code, dom).unwrap();
    let code = String::from_utf8(code).unwrap();
    assert!(code.contains("<link>https://example.org/post.html?a=1&amp;b=2</link>"));
    assert!(code.contains("<description>A &amp;amp; B&lt;img src=\"https://example.org/image.png?a=1&amp;amp;b=2\"&gt;</description>"));
    assert!(code.contains("<x:img src=\"https://example.org/image.png?a=1&amp;b=2\"/>"));
  }
}
