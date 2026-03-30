// Copyright 2014-2017 The html5ever Project Developers. See the
// COPYRIGHT file at the top-level directory of this distribution.
//
// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.

// Modified from xml5ever to support self closing tags.

use crate::arena::{NodeData, Ref};
use std::io::{self, Write};
use xml5ever::tree_builder::NamespaceMap;
use xml5ever::{Attribute, QualName};

/// Method for serializing generic node to a given writer.
pub fn serialize<'arena, Wr>(writer: Wr, node: Ref<'arena>) -> io::Result<()>
where
  Wr: Write,
{
  let mut set = XmlSerializer::new(writer);
  set.serialize_node(node)
}

/// Struct used for serializing nodes into a text that other XML
/// parses can read.
///
/// Serializer contains a set of functions (start_elem, end_elem...)
/// that make parsing nodes easier.
pub struct XmlSerializer<Wr> {
  writer: Wr,
  namespace_stack: NamespaceMapStack,
}

#[derive(Debug)]
struct NamespaceMapStack(Vec<NamespaceMap>);

impl NamespaceMapStack {
  fn new() -> NamespaceMapStack {
    NamespaceMapStack(vec![])
  }

  fn push(&mut self, namespace: NamespaceMap) {
    self.0.push(namespace);
  }

  fn pop(&mut self) {
    self.0.pop();
  }
}

/// Writes given text into the Serializer, escaping it,
/// depending on where the text is written inside the tag or attribute value.
///
/// For example
///```text
///    <tag>'&-quotes'</tag>   becomes      <tag>'&amp;-quotes'</tag>
///    <tag = "'&-quotes'">    becomes      <tag = "&apos;&amp;-quotes&apos;"
///```
fn write_to_buf_escaped<W: Write>(writer: &mut W, text: &str, attr_mode: bool) -> io::Result<()> {
  for c in text.chars() {
    match c {
      '&' => writer.write_all(b"&amp;"),
      '\'' if attr_mode => writer.write_all(b"&apos;"),
      '"' if attr_mode => writer.write_all(b"&quot;"),
      '<' if !attr_mode => writer.write_all(b"&lt;"),
      '>' if !attr_mode => writer.write_all(b"&gt;"),
      c => writer.write_fmt(format_args!("{c}")),
    }?;
  }
  Ok(())
}

#[inline]
fn write_qual_name<W: Write>(writer: &mut W, name: &QualName) -> io::Result<()> {
  if let Some(ref prefix) = name.prefix {
    writer.write_all(prefix.as_bytes())?;
    writer.write_all(b":")?;
  }

  writer.write_all(name.local.as_bytes())?;
  Ok(())
}

impl<Wr: Write> XmlSerializer<Wr> {
  /// Creates a new Serializier from a writer and given serialization options.
  pub fn new(writer: Wr) -> Self {
    XmlSerializer {
      writer,
      namespace_stack: NamespaceMapStack::new(),
    }
  }

  #[inline(always)]
  fn qual_name(&mut self, name: &QualName) -> io::Result<()> {
    self.find_or_insert_ns(name);
    write_qual_name(&mut self.writer, name)
  }

  #[inline(always)]
  fn qual_attr_name(&mut self, name: &QualName) -> io::Result<()> {
    self.find_or_insert_ns(name);
    write_qual_name(&mut self.writer, name)
  }

  fn find_uri(&self, name: &QualName) -> bool {
    let mut found = false;
    for stack in self.namespace_stack.0.iter().rev() {
      if let Some(Some(el)) = stack.get(&name.prefix) {
        found = *el == name.ns;
        break;
      }
    }
    found
  }

  fn find_or_insert_ns(&mut self, name: &QualName) {
    if (name.prefix.is_some() || !name.ns.is_empty()) && !self.find_uri(name) {
      if let Some(last_ns) = self.namespace_stack.0.last_mut() {
        last_ns.insert(name);
      }
    }
  }

  fn serialize_node<'arena>(&mut self, node: Ref<'arena>) -> io::Result<()> {
    match &node.data {
      NodeData::Element {
        name,
        attrs,
        template_contents,
        ..
      } => {
        self.start_elem(node, name, &*attrs.borrow())?;

        let mut child = node.first_child.get();
        while let Some(n) = child {
          self.serialize_node(n)?;
          child = n.next_sibling.get();
        }

        if let Some(template_contents) = template_contents {
          self.serialize_node(template_contents)?;
        }

        self.end_elem(node, name)?;
      }
      NodeData::Comment { contents } => {
        self.write_comment(contents)?;
      }
      NodeData::Doctype { name, .. } => {
        self.write_doctype(name)?;
      }
      NodeData::Document => {
        let mut child = node.first_child.get();
        while let Some(n) = child {
          self.serialize_node(n)?;
          child = n.next_sibling.get();
        }
      }
      NodeData::ProcessingInstruction { target, contents } => {
        self.write_processing_instruction(target, contents.borrow().as_ref())?;
      }
      NodeData::Text { contents } => {
        self.write_text(contents.borrow().as_ref())?;
      }
    }
    Ok(())
  }

  /// Serializes given start element into text. Start element contains
  /// qualified name and an attributes iterator.
  fn start_elem<'arena>(
    &mut self,
    node: Ref<'arena>,
    name: &QualName,
    attrs: &Vec<Attribute>,
  ) -> io::Result<()> {
    self.namespace_stack.push(NamespaceMap::empty());

    self.writer.write_all(b"<")?;
    self.qual_name(name)?;
    for attr in attrs.iter() {
      self.writer.write_all(b" ")?;
      self.qual_attr_name(&attr.name)?;
      self.writer.write_all(b"=\"")?;
      write_to_buf_escaped(&mut self.writer, &attr.value, true)?;
      self.writer.write_all(b"\"")?;
    }
    if node.first_child.get().is_some() {
      self.writer.write_all(b">")?;
    } else {
      self.writer.write_all(b"/>")?;
    }
    Ok(())
  }

  /// Serializes given end element into text.
  fn end_elem<'arena>(&mut self, node: Ref<'arena>, name: &QualName) -> io::Result<()> {
    self.namespace_stack.pop();
    if node.first_child.get().is_none() {
      return Ok(());
    }
    self.writer.write_all(b"</")?;
    self.qual_name(&name)?;
    self.writer.write_all(b">")
  }

  /// Serializes comment into text.
  fn write_comment(&mut self, text: &str) -> io::Result<()> {
    self.writer.write_all(b"<!--")?;
    self.writer.write_all(text.as_bytes())?;
    self.writer.write_all(b"-->")
  }

  /// Serializes given doctype
  fn write_doctype(&mut self, name: &str) -> io::Result<()> {
    self.writer.write_all(b"<!DOCTYPE ")?;
    self.writer.write_all(name.as_bytes())?;
    self.writer.write_all(b">")
  }

  /// Serializes text for a node or an attributes.
  fn write_text(&mut self, text: &str) -> io::Result<()> {
    write_to_buf_escaped(&mut self.writer, text, false)
  }

  /// Serializes given processing instruction.
  fn write_processing_instruction(&mut self, target: &str, data: &str) -> io::Result<()> {
    self.writer.write_all(b"<?")?;
    self.writer.write_all(target.as_bytes())?;
    self.writer.write_all(b" ")?;
    self.writer.write_all(data.as_bytes())?;
    self.writer.write_all(b"?>")
  }
}
