use std::{
  cell::{Cell, RefCell},
  collections::VecDeque,
  fmt::Debug,
  hash::{DefaultHasher, Hash, Hasher},
};

use crate::arena::{NodeData, Ref};
use serde::Deserialize;
use xml5ever::{local_name, tendril::StrTendril, Attribute, Namespace, QualName};

use oxvg_ast::{
  attribute::{Attr, Attributes},
  class_list::ClassList,
  document::Document,
  element::Element,
  implementations::markup5ever::{Attributes5Ever, ClassList5Ever},
  name::Name,
  node::{self, Node},
};

use oxvg_ast::serialize;

pub struct OxvgNode<'arena> {
  pub arena: crate::arena::Arena<'arena>,
  pub node: Ref<'arena>,
}

impl Clone for OxvgNode<'_> {
  fn clone(&self) -> Self {
    OxvgNode {
      arena: self.arena,
      node: self.node,
    }
  }
}

impl Debug for OxvgNode<'_> {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.node.fmt(f)
  }
}

impl PartialEq for OxvgNode<'_> {
  fn eq(&self, other: &Self) -> bool {
    self.node.eq(other.node)
  }
}

impl Eq for OxvgNode<'_> {}

impl Hash for OxvgNode<'_> {
  fn hash<H: Hasher>(&self, state: &mut H) {
    self.as_ptr_byte().hash(state)
  }
}

impl<'arena> Node for OxvgNode<'arena> {
  type Atom = StrTendril;
  type Child = OxvgNode<'arena>;
  type ParentChild = OxvgNode<'arena>;
  type Parent = OxvgNode<'arena>;

  fn ptr_eq(&self, other: &impl Node) -> bool {
    self.as_ptr_byte() == other.as_ptr_byte()
  }

  fn as_ptr_byte(&self) -> usize {
    self.node as *const crate::arena::Node as usize
  }

  // fn as_ref(&self) -> Box<dyn node::Ref> {
  //   Box::new(Node5EverRef(Rc::new(self.clone())))
  // }

  fn child_nodes_iter(&self) -> impl DoubleEndedIterator<Item = Self> {
    struct ChildIter<'arena> {
      arena: crate::arena::Arena<'arena>,
      cur: Option<Ref<'arena>>,
    }

    impl<'arena> Iterator for ChildIter<'arena> {
      type Item = OxvgNode<'arena>;

      fn next(&mut self) -> Option<Self::Item> {
        if let Some(c) = self.cur {
          self.cur = c.next_sibling.get();
          Some(OxvgNode {
            node: c,
            arena: self.arena,
          })
        } else {
          None
        }
      }
    }

    impl<'arena> DoubleEndedIterator for ChildIter<'arena> {
      fn next_back(&mut self) -> Option<Self::Item> {
        if let Some(c) = self.cur {
          self.cur = c.previous_sibling.get();
          Some(OxvgNode {
            node: c,
            arena: self.arena,
          })
        } else {
          None
        }
      }
    }

    ChildIter {
      cur: self.node.first_child.get(),
      arena: self.arena,
    }
  }

  fn has_child_nodes(&self) -> bool {
    self.node.first_child.get().is_some()
  }

  fn first_child(&self) -> Option<impl Node> {
    self.node.first_child.get().map(|node| OxvgNode {
      arena: self.arena,
      node,
    })
  }

  fn last_child(&self) -> Option<impl Node> {
    self.node.last_child.get().map(|node| OxvgNode {
      arena: self.arena,
      node,
    })
  }

  fn next_sibling(&self) -> Option<Self::ParentChild> {
    self.node.next_sibling.get().map(|node| OxvgNode {
      arena: self.arena,
      node,
    })
  }

  fn child_nodes(&self) -> Vec<Self::Child> {
    let mut children = Vec::new();
    let mut child = self.node.first_child.get();
    while let Some(c) = child {
      children.push(OxvgNode {
        node: c,
        arena: self.arena,
      });
      child = c.next_sibling.get();
    }
    children
  }

  fn child_node_count(&self) -> usize {
    let mut count = 0;
    let mut child = self.node.first_child.get();
    while let Some(c) = child {
      count += 1;
      child = c.next_sibling.get();
    }
    count
  }

  #[allow(refining_impl_trait)]
  fn element(&self) -> Option<OxvgNode<'arena>> {
    match self.node_type() {
      node::Type::Element => <OxvgNode as Element>::new(Node::to_owned(self)),
      _ => None,
    }
  }

  fn empty(&self) {
    let mut child = self.node.first_child.get();
    while let Some(c) = child {
      child = c.next_sibling.get();
      c.detach();
    }
  }

  #[allow(refining_impl_trait)]
  fn find_element(&self) -> Option<OxvgNode<'arena>> {
    <OxvgNode as Element>::find_element(Node::to_owned(self))
  }

  fn for_each_child<F>(&self, mut f: F)
  where
    F: FnMut(Self),
  {
    let mut child = self.node.first_child.get();
    while let Some(c) = child {
      f(OxvgNode {
        node: c,
        arena: self.arena,
      });
      child = c.next_sibling.get();
    }
  }

  fn try_for_each_child<F, E>(&self, mut f: F) -> Result<(), E>
  where
    F: FnMut(Self) -> Result<(), E>,
  {
    let mut child = self.node.first_child.get();
    while let Some(c) = child {
      f(OxvgNode {
        node: c,
        arena: self.arena,
      })?;
      child = c.next_sibling.get();
    }
    Ok(())
  }

  fn any_child<F>(&self, mut f: F) -> bool
  where
    F: FnMut(Self) -> bool,
  {
    let mut child = self.node.first_child.get();
    while let Some(c) = child {
      if f(OxvgNode {
        node: c,
        arena: self.arena,
      }) {
        return true;
      }
      child = c.next_sibling.get();
    }
    false
  }

  fn all_children<F>(&self, mut f: F) -> bool
  where
    F: FnMut(Self) -> bool,
  {
    let mut child = self.node.first_child.get();
    while let Some(c) = child {
      if !f(OxvgNode {
        node: c,
        arena: self.arena,
      }) {
        return false;
      }
      child = c.next_sibling.get();
    }
    true
  }

  fn retain_children<F>(&self, mut f: F)
  where
    F: FnMut(Self::Child) -> bool,
  {
    let mut child = self.node.first_child.get();
    while let Some(c) = child {
      child = c.next_sibling.get();
      if !f(OxvgNode {
        node: c,
        arena: self.arena,
      }) {
        c.detach();
      }
    }
  }

  fn node_type(&self) -> node::Type {
    match &self.node.data {
      NodeData::Comment { .. } => node::Type::Comment,
      NodeData::Doctype { .. } => node::Type::DocumentType,
      NodeData::Document => node::Type::Document,
      NodeData::Element { .. } => node::Type::Element,
      NodeData::ProcessingInstruction { .. } => node::Type::ProcessingInstruction,
      NodeData::Text { .. } => node::Type::Text,
    }
  }

  #[allow(refining_impl_trait)]
  fn parent_node(&self) -> Option<OxvgNode<'arena>> {
    self.node.parent.get().map(|parent| OxvgNode {
      node: parent,
      arena: self.arena,
    })
  }

  #[allow(refining_impl_trait)]
  fn set_parent_node(&self, new_parent: &Self::Parent) -> Option<OxvgNode<'arena>> {
    let parent = self.node.parent.get();
    self.node.detach();
    self.node.parent.set(Some(new_parent.node));
    parent.map(|parent| OxvgNode {
      node: parent,
      arena: self.arena,
    })
  }

  fn append_child(&mut self, a_child: Self::Child) {
    self.node.append(a_child.node);
  }

  fn insert_before(&mut self, new_node: Self::Child, reference_node: &Self::Child) {
    reference_node.node.insert_before(new_node.node);
  }

  fn insert_after(&mut self, new_node: Self::Child, reference_node: &Self::Child) {
    reference_node.node.insert_after(new_node.node);
  }

  fn insert(&mut self, index: usize, new_node: Self::Child) {
    let mut child = self.node.first_child.get();
    let mut i = 0;
    while let Some(c) = child {
      if i == index {
        c.insert_before(new_node.node);
        break;
      }
      i += 1;
      child = c.next_sibling.get();
    }
    if i == index {
      self.node.append(new_node.node);
    }
  }

  fn node_name(&self) -> Self::Atom {
    match &self.node.data {
      NodeData::Comment { .. } => "#comment".into(),
      NodeData::Doctype { name, .. } => name.clone(),
      NodeData::Document => "#document".into(),
      NodeData::Element { name, .. } => name.local.to_uppercase().into(),
      NodeData::ProcessingInstruction { target, .. } => target.clone(),
      NodeData::Text { .. } => "#text".into(),
    }
  }

  fn node_value(&self) -> Option<Self::Atom> {
    Some(match &self.node.data {
      NodeData::Comment { contents } => contents.clone(),
      NodeData::ProcessingInstruction { contents, .. } => contents.borrow().clone(),
      NodeData::Text { contents } => contents.borrow().clone(),
      _ => return None,
    })
  }

  fn processing_instruction(&self) -> Option<(Self::Atom, Self::Atom)> {
    match &self.node.data {
      NodeData::ProcessingInstruction { target, contents } => {
        Some((target.clone(), contents.borrow().clone()))
      }
      _ => None,
    }
  }

  fn try_set_node_value(&self, value: Self::Atom) -> Option<()> {
    match &self.node.data {
      NodeData::Text { contents } => {
        contents.replace(value);
        Some(())
      }
      _ => None,
    }
  }

  fn text_content(&self) -> Option<String> {
    match &self.node.data {
      NodeData::Doctype { .. } | NodeData::Document => None,
      // FIXME: Empty string should only be returned on recursive calls
      NodeData::Comment { contents } => Some(contents.to_string()),
      NodeData::ProcessingInstruction { contents, .. } => Some(contents.borrow().to_string()),
      NodeData::Text { contents } => Some(contents.borrow().to_string()),
      NodeData::Element { .. } => Some(self.node.text_content()),
    }
  }

  fn set_text_content(&mut self, content: Self::Atom) {
    match &self.node.data {
      NodeData::Text { contents } => *contents.borrow_mut() = content,
      NodeData::Element { .. } => {
        let text = self.text(content);
        self.empty();
        self.append_child(text);
      }
      _ => {}
    }
  }

  fn text(&self, content: Self::Atom) -> Self {
    OxvgNode {
      node: self.arena.alloc(crate::arena::Node::new(
        NodeData::Text {
          contents: RefCell::new(content),
        },
        0,
      )),
      arena: self.arena,
    }
  }

  fn remove(&self) {
    self.node.detach();
  }

  fn remove_child(&mut self, child: Self::Child) -> Option<Self::Child> {
    if child.node.parent.get() == Some(self.node) {
      child.node.detach();
      Some(child)
    } else {
      None
    }
  }

  fn remove_child_at(&mut self, index: usize) -> Option<Self::Child> {
    let mut child = self.node.first_child.get();
    let mut i = 0;
    while let Some(c) = child {
      if i == index {
        c.detach();
        return Some(OxvgNode {
          arena: self.arena,
          node: c,
        });
      }
      i += 1;
      child = c.next_sibling.get();
    }
    None
  }

  fn clone_node(&self) -> Self {
    OxvgNode {
      node: self
        .arena
        .alloc(crate::arena::Node::new(self.node.data.clone(), 0)),
      arena: self.arena,
    }
  }

  fn replace_child(
    &mut self,
    new_child: Self::Child,
    old_child: &Self::Child,
  ) -> Option<Self::Child> {
    let parent = old_child.node.parent.get();
    if let Some(parent) = parent {
      if parent != self.node {
        return None;
      }
    } else {
      return None;
    }
    let parent = old_child.node.parent.take();
    let previous_sibling = old_child.node.previous_sibling.take();
    let next_sibling = old_child.node.next_sibling.take();

    new_child.node.parent.set(parent);
    if previous_sibling.is_some() {
      new_child.node.previous_sibling.set(previous_sibling);
    } else {
      self.node.first_child.set(Some(new_child.node));
    }
    if next_sibling.is_some() {
      new_child.node.next_sibling.set(next_sibling);
    } else {
      self.node.last_child.set(Some(new_child.node));
    }
    Some(OxvgNode {
      arena: self.arena,
      node: old_child.node,
    })
  }

  fn to_owned(&self) -> Self {
    self.clone()
  }

  fn as_child(&self) -> Self::Child {
    self.clone()
  }

  fn as_impl(&self) -> impl Node {
    self.clone()
  }

  fn as_parent_child(&self) -> Self::ParentChild {
    Node::to_owned(self)
  }
}

impl<'arena> node::Features for OxvgNode<'arena> {}

impl<'arena> oxvg_ast::parse::Node for OxvgNode<'arena> {
  fn parse(_source: &str) -> anyhow::Result<Self> {
    todo!()
  }

  fn parse_file(mut _file: &std::fs::File) -> anyhow::Result<Self> {
    todo!()
  }

  fn parse_path(_path: &std::path::Path) -> anyhow::Result<Self> {
    todo!()
  }
}

impl<'arena> oxvg_ast::serialize::Node for OxvgNode<'arena> {
  fn serialize(&self) -> anyhow::Result<String> {
    todo!()
  }

  fn serialize_with_options(&self, _options: serialize::Options) -> anyhow::Result<String> {
    todo!()
  }

  fn serialize_into<Wr: std::io::Write>(&self, _sink: Wr) -> anyhow::Result<()> {
    todo!()
  }
}

impl<'arena> Element for OxvgNode<'arena> {
  type Name = QualName;
  type Attr = Attribute;
  type Attributes<'a> = Attributes5Ever<'a>;

  fn new(node: Self::Child) -> Option<Self> {
    if !matches!(node.node_type(), node::Type::Element | node::Type::Document) {
      return None;
    }
    Some(node)
  }

  fn as_document(&self) -> impl Document<Root = Self> {
    if matches!(self.node.data, NodeData::Document) {
      self.clone()
    } else {
      unreachable!()
    }
  }

  fn from_parent(node: Self::ParentChild) -> Option<Self> {
    Self::new(node)
  }

  fn attributes(&self) -> Self::Attributes<'_> {
    let attrs = if let NodeData::Element { attrs, .. } = &self.node.data {
      attrs
    } else {
      unreachable!()
    };
    Attributes5Ever(attrs)
  }

  fn set_attributes(&self, new_attrs: Self::Attributes<'_>) {
    let attrs = if let NodeData::Element { attrs, .. } = &self.node.data {
      attrs
    } else {
      unreachable!()
    };
    attrs.replace(new_attrs.0.take());
  }

  fn class_list(
    &self,
  ) -> impl ClassList<Attribute = <Self::Attributes<'_> as Attributes>::Attribute> {
    ClassList5Ever {
      attrs: self.attributes(),
      class_index_memo: Cell::new(0),
      tokens: self
        .attributes()
        .get_named_item_local(&local_name!("class"))
        .as_ref()
        .map(|a| a.value().split_whitespace().map(Into::into).collect())
        .unwrap_or_default(),
    }
  }

  fn has_class(&self, token: &Self::Atom) -> bool {
    let token = token.trim_start_matches('.');
    self.class_list().contains(&token.into())
  }

  fn document(&self) -> Option<Self> {
    let parent = self.parent_node()?;
    match parent.node.data {
      NodeData::Element { .. } => parent.document(),
      NodeData::Document => Some(parent),
      _ => None,
    }
  }

  fn for_each_element_child<F>(&self, mut f: F)
  where
    F: FnMut(Self),
  {
    #[allow(deprecated)]
    for child in self.child_nodes_iter() {
      if let NodeData::Element { .. } = &child.node.data {
        f(child)
      }
    }
  }

  fn sort_child_elements<F>(&self, mut f: F)
  where
    F: FnMut(Self, Self) -> std::cmp::Ordering,
  {
    let mut children = self.child_nodes();
    children.sort_by(|a, b| {
      let Some(a) = OxvgNode::new(a.clone()) else {
        return std::cmp::Ordering::Less;
      };
      let Some(b) = OxvgNode::new(b.clone()) else {
        return std::cmp::Ordering::Greater;
      };
      f(a.clone(), b.clone())
    });
    self.empty();
    for child in children {
      self.node.append(child.node);
    }
  }

  fn flatten(&self) {
    let parent = self.node.parent.take();
    let first_child = self.node.first_child.take();
    let last_child = self.node.last_child.take();

    if let Some(parent) = parent {
      if let Some(prev) = self.node.previous_sibling.take() {
        prev.next_sibling.set(first_child);
        if let Some(child) = first_child {
          child.previous_sibling.set(Some(prev));
        }
      } else {
        parent.first_child.set(first_child);
        if let Some(child) = first_child {
          child.previous_sibling.set(None);
        }
      }
      if let Some(next) = self.node.next_sibling.take() {
        next.previous_sibling.set(last_child);
        if let Some(child) = last_child {
          child.next_sibling.set(Some(next));
        }
      } else {
        parent.last_child.set(last_child);
        if let Some(child) = last_child {
          child.next_sibling.set(None);
        }
      }
    }

    let mut child = first_child;
    while let Some(c) = child {
      c.parent.set(parent);
      child = c.next_sibling.get();
    }
  }

  fn qual_name(&self) -> &Self::Name {
    if let NodeData::Element { name, .. } = &self.node.data {
      name
    } else {
      unreachable!()
    }
  }

  fn set_local_name(&mut self, local: <Self::Name as Name>::LocalName) {
    let mut data = self.node.data.clone();
    if let NodeData::Element { name, .. } = &mut data {
      name.local = local;
    }
    let node = self
      .arena
      .alloc(crate::arena::Node::new(data, self.node.line));
    let mut child = self.node.first_child.take();
    node.first_child.set(child);
    while let Some(c) = child {
      c.parent.set(Some(node));
      child = c.next_sibling.get();
    }
    node.last_child.set(self.node.last_child.take());
    self.replace_with(OxvgNode {
      node,
      arena: self.arena,
    });
  }

  fn append(&self, node: Self::Child) {
    self.node.append(node.node);
  }

  fn find_element(node: <Self as Node>::ParentChild) -> Option<Self> {
    let mut queue = VecDeque::new();
    queue.push_back(node.node);

    while let Some(current) = queue.pop_front() {
      if matches!(current.data, NodeData::Element { .. }) {
        return Some(OxvgNode {
          node: current,
          arena: node.arena,
        });
      }

      let mut child = current.first_child.get();
      while let Some(c) = child {
        queue.push_back(c);
        child = c.next_sibling.get();
      }
    }
    None
  }

  fn get_attribute<'a>(
    &'a self,
    name: &<<Self::Attributes<'a> as Attributes<'a>>::Attribute as Attr>::Name,
  ) -> Option<Self::Atom> {
    self.get_attribute_node(name).map(|a| a.value.clone())
  }

  fn get_attribute_local<'a>(
    &'a self,
    name: &<<Self::Attr as Attr>::Name as Name>::LocalName,
  ) -> Option<Self::Atom> {
    self.get_attribute_node_local(name).map(|a| a.value.clone())
  }

  fn get_attribute_ns<'a>(
    &'a self,
    namespace: &<<<Self::Attributes<'a> as Attributes<'a>>::Attribute as Attr>::Name as Name>::Namespace,
    name: &<<<Self::Attributes<'a> as Attributes<'a>>::Attribute as Attr>::Name as Name>::LocalName,
  ) -> Option<Self::Atom> {
    self
      .get_attribute_node_ns(namespace, name)
      .map(|a| a.value.clone())
  }

  fn get_attribute_names(
    &self,
  ) -> Vec<<<Self::Attributes<'_> as Attributes<'_>>::Attribute as Attr>::Name> {
    let mut output = vec![];
    for attr in self.attributes().0.borrow().iter() {
      output.push(attr.name.clone());
    }
    output
  }

  fn get_attribute_node<'a>(
    &'a self,
    attr_name: &<<Self::Attributes<'a> as Attributes<'a>>::Attribute as Attr>::Name,
  ) -> Option<std::cell::Ref<'a, html5ever::Attribute>> {
    self.attributes().get_named_item(attr_name)
  }

  fn get_attribute_node_mut<'a>(
    &'a self,
    attr_name: &<<Self::Attributes<'a> as Attributes<'a>>::Attribute as Attr>::Name,
  ) -> Option<std::cell::RefMut<'a, html5ever::Attribute>> {
    self.attributes().get_named_item_mut(attr_name)
  }

  fn get_attribute_node_ns<'a>(
    &'a self,
    namespace: &<<<Self::Attributes<'a> as Attributes<'a>>::Attribute as Attr>::Name as Name>::Namespace,
    name: &<<<Self::Attributes<'a> as Attributes<'a>>::Attribute as Attr>::Name as Name>::LocalName,
  ) -> Option<std::cell::Ref<'a, html5ever::Attribute>> {
    self.attributes().get_named_item_ns(namespace, name)
  }

  fn replace_children(&self, children: Vec<Self::Child>) {
    self.empty();
    for child in children {
      self.node.append(child.node);
    }
  }

  fn parent_element(&self) -> Option<Self> {
    let parent_node: OxvgNode<'arena> = self.parent_node()?;
    Self::new(parent_node)
  }

  fn next_element_sibling(&self) -> Option<Self> {
    let mut node = self.node.next_sibling.get();
    while let Some(n) = node {
      if matches!(n.data, NodeData::Element { .. }) {
        return Some(OxvgNode {
          arena: self.arena,
          node: n,
        });
      }
      node = n.next_sibling.get();
    }
    None
  }

  fn previous_element_sibling(&self) -> Option<Self> {
    let mut node = self.node.previous_sibling.get();
    while let Some(n) = node {
      if matches!(n.data, NodeData::Element { .. }) {
        return Some(OxvgNode {
          arena: self.arena,
          node: n,
        });
      }
      node = n.previous_sibling.get();
    }
    None
  }

  fn prepend(&self, other: Self::ParentChild) {
    self.node.prepend(other.node);
  }

  fn after(&self, node: <Self as Node>::ParentChild) {
    self.node.insert_after(node.node);
  }

  fn before(&self, node: <Self as Node>::ParentChild) -> Option<()> {
    self.node.insert_before(node.node);
    Some(())
  }
}

impl<'arena> selectors::Element for OxvgNode<'arena> {
  type Impl = oxvg_ast::selectors::SelectorImpl<
    <Self as Node>::Atom,
    <<Self as Element>::Name as Name>::LocalName,
    <<Self as Element>::Name as Name>::Namespace,
  >;

  fn opaque(&self) -> selectors::OpaqueElement {
    selectors::OpaqueElement::new(self)
  }

  fn parent_element(&self) -> Option<Self> {
    Element::parent_element(self)
  }

  fn parent_node_is_shadow_root(&self) -> bool {
    false
  }

  fn containing_shadow_host(&self) -> Option<Self> {
    None
  }

  fn is_pseudo_element(&self) -> bool {
    false
  }

  fn prev_sibling_element(&self) -> Option<Self> {
    Element::previous_element_sibling(self)
  }

  fn next_sibling_element(&self) -> Option<Self> {
    Element::next_element_sibling(self)
  }

  fn first_element_child(&self) -> Option<Self> {
    self.children().first().cloned()
  }

  fn is_html_element_in_html_document(&self) -> bool {
    true
  }

  fn has_local_name(
    &self,
    local_name: &<Self::Impl as selectors::SelectorImpl>::BorrowedLocalName,
  ) -> bool {
    if self.node_type() == node::Type::Document {
      false
    } else {
      self.local_name() == &local_name.0
    }
  }

  fn has_namespace(
    &self,
    ns: &<Self::Impl as selectors::SelectorImpl>::BorrowedNamespaceUrl,
  ) -> bool {
    self.qual_name().ns() == &ns.0
  }

  fn is_same_type(&self, other: &Self) -> bool {
    let name = self.qual_name();
    let other_name = other.qual_name();

    name.local_name() == other_name.local_name() && name.prefix() == other_name.prefix()
  }

  fn attr_matches(
    &self,
    ns: &selectors::attr::NamespaceConstraint<
      &<Self::Impl as selectors::SelectorImpl>::NamespaceUrl,
    >,
    local_name: &<Self::Impl as selectors::SelectorImpl>::LocalName,
    operation: &selectors::attr::AttrSelectorOperation<
      &<Self::Impl as selectors::SelectorImpl>::AttrValue,
    >,
  ) -> bool {
    use selectors::attr::NamespaceConstraint;

    let value = match ns {
      NamespaceConstraint::Any => self.get_attribute_local(&local_name.0),
      NamespaceConstraint::Specific(ns) => self.get_attribute_ns(&ns.0, &local_name.0),
    };
    let Some(value) = value else {
      return false;
    };
    let string = value.as_ref();
    operation.eval_str(string)
  }

  fn match_non_ts_pseudo_class(
    &self,
    pc: &<Self::Impl as selectors::SelectorImpl>::NonTSPseudoClass,
    _context: &mut selectors::context::MatchingContext<Self::Impl>,
  ) -> bool {
    use oxvg_ast::selectors::PseudoClass;

    match pc {
      PseudoClass::Link(..) | PseudoClass::AnyLink(..) => self.is_link(),
    }
  }

  fn match_pseudo_element(
    &self,
    _pe: &<Self::Impl as selectors::SelectorImpl>::PseudoElement,
    _context: &mut selectors::context::MatchingContext<Self::Impl>,
  ) -> bool {
    false
  }

  fn apply_selector_flags(&self, _flags: selectors::matching::ElementSelectorFlags) {
    // TODO: seems unused?
  }

  fn is_link(&self) -> bool {
    if self.node_type() == node::Type::Document {
      return false;
    }
    matches!(
      self.local_name(),
      &local_name!("a") | &local_name!("area") | &local_name!("link")
    ) && self.has_attribute_local(&local_name!("href"))
  }

  fn is_html_slot_element(&self) -> bool {
    false
  }

  fn has_id(
    &self,
    id: &<Self::Impl as selectors::SelectorImpl>::Identifier,
    case_sensitivity: selectors::attr::CaseSensitivity,
  ) -> bool {
    let Some(self_id) = self.get_attribute_local(&local_name!("id")) else {
      return false;
    };
    case_sensitivity.eq(id.0.as_bytes(), self_id.as_bytes())
  }

  fn has_class(
    &self,
    name: &<Self::Impl as selectors::SelectorImpl>::Identifier,
    case_sensitivity: selectors::attr::CaseSensitivity,
  ) -> bool {
    if self.node_type() == node::Type::Document {
      return false;
    }

    let Some(self_class) = self.get_attribute_local(&local_name!("class")) else {
      return false;
    };
    let name = name.0.as_bytes();
    self_class
      .split_whitespace()
      .any(|c| case_sensitivity.eq(name, c.as_bytes()))
  }

  fn imported_part(
    &self,
    _name: &<Self::Impl as selectors::SelectorImpl>::Identifier,
  ) -> Option<<Self::Impl as selectors::SelectorImpl>::Identifier> {
    None
  }

  fn is_part(&self, _name: &<Self::Impl as selectors::SelectorImpl>::Identifier) -> bool {
    false
  }

  fn is_empty(&self) -> bool {
    !self.has_child_nodes()
      || self.all_children(|child| match &child.node.data {
        NodeData::Text { contents } => contents.borrow().trim().is_empty(),
        _ => false,
      })
  }

  fn is_root(&self) -> bool {
    let Some(parent) = self.parent_node() else {
      return true;
    };
    parent.node_type() == node::Type::Document
  }

  fn has_custom_state(&self, _name: &<Self::Impl as selectors::SelectorImpl>::Identifier) -> bool {
    false
  }

  #[allow(clippy::cast_possible_truncation)]
  fn add_element_unique_hashes(&self, filter: &mut selectors::bloom::BloomFilter) -> bool {
    let mut f = |hash: u32| filter.insert_hash(hash & selectors::bloom::BLOOM_HASH_MASK);

    let local_name_hash = &mut DefaultHasher::default();
    self.local_name().hash(local_name_hash);
    f(local_name_hash.finish() as u32);

    let prefix_hash = &mut DefaultHasher::default();
    self.prefix().hash(prefix_hash);
    f(prefix_hash.finish() as u32);

    if let Some(id) = self.get_attribute(&QualName {
      prefix: None,
      ns: Namespace::default(),
      local: local_name!("id"),
    }) {
      let id_hash = &mut DefaultHasher::default();
      id.hash(id_hash);
      f(prefix_hash.finish() as u32);
    }

    for class in self.class_list().iter() {
      let class_hash = &mut DefaultHasher::default();
      class.hash(class_hash);
      f(class_hash.finish() as u32);
    }

    for attr in self.attributes().into_iter() {
      let name = attr.name();
      if matches!(name.local_name().as_ref(), "class" | "id" | "style") {
        continue;
      }

      let name_hash = &mut DefaultHasher::default();
      name.hash(name_hash);
      f(name_hash.finish() as u32);
    }
    true
  }
}

impl<'arena> oxvg_ast::element::Features for OxvgNode<'arena> {}

impl<'arena> Document for OxvgNode<'arena> {
  type Root = OxvgNode<'arena>;

  fn document_element(&self) -> &Self::Root {
    self
  }

  fn create_attribute<'a>(
    &self,
    name: <<<Self::Root as Element>::Attributes<'a> as Attributes<'a>>::Attribute as Attr>::Name,
  ) -> <<Self::Root as Element>::Attributes<'a> as Attributes<'a>>::Attribute {
    Attribute {
      name,
      value: StrTendril::default(),
    }
  }

  fn create_c_data_section(&self, data: <Self::Root as Node>::Atom) -> <Self::Root as Node>::Child {
    let node = self.arena.alloc(crate::arena::Node::new(
      NodeData::Text {
        contents: RefCell::new(data),
      },
      0,
    ));
    OxvgNode {
      node,
      arena: self.arena,
    }
  }

  fn create_element(&self, tag_name: <Self::Root as Element>::Name) -> Self::Root {
    let node = self.arena.alloc(crate::arena::Node::new(
      NodeData::Element {
        name: tag_name,
        attrs: RefCell::new(vec![]),
        template_contents: None,
        mathml_annotation_xml_integration_point: false,
      },
      0,
    ));
    OxvgNode {
      node,
      arena: self.arena,
    }
  }

  fn create_processing_instruction(
    &self,
    target: <Self::Root as Node>::Atom,
    data: <Self::Root as Node>::Atom,
  ) -> <<Self::Root as Node>::Child as Node>::ParentChild {
    let node = self.arena.alloc(crate::arena::Node::new(
      NodeData::ProcessingInstruction {
        target,
        contents: RefCell::new(data),
      },
      0,
    ));
    OxvgNode {
      node,
      arena: self.arena,
    }
  }

  fn create_text_node(&self, data: <Self::Root as Node>::Atom) -> <Self::Root as Node>::Child {
    let node = self.arena.alloc(crate::arena::Node::new(
      NodeData::Text {
        contents: RefCell::new(data),
      },
      0,
    ));
    OxvgNode {
      node,
      arena: self.arena,
    }
  }
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrefixIdsOptions {
  pub delim: Option<String>,
  #[serde(default)]
  pub prefix: Option<String>,
  #[serde(default)]
  pub prefix_ids: Option<bool>,
  #[serde(default)]
  pub prefix_class_names: Option<bool>,
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OxvgConfig {
  #[serde(deserialize_with = "ok_or_default")]
  pub default: DefaultTrue,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub add_attributes_to_svg_element: ConfigItem<oxvg_optimiser::AddAttributesToSVGElement>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub add_classes_to_svg: ConfigItem<oxvg_optimiser::AddClassesToSVG>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub cleanup_list_of_values: ConfigItem<oxvg_optimiser::CleanupListOfValues>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub prefix_ids: ConfigItem<PrefixIdsOptions>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_attributes_by_selector: ConfigItem<oxvg_optimiser::RemoveAttributesBySelector>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_attrs: ConfigItem<oxvg_optimiser::RemoveAttrs>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_dimensions: ConfigItem<oxvg_optimiser::RemoveDimensions>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_elements_by_attr: ConfigItem<oxvg_optimiser::RemoveElementsByAttr>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_off_canvas_paths: ConfigItem<oxvg_optimiser::RemoveOffCanvasPaths>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_raster_images: ConfigItem<oxvg_optimiser::RemoveRasterImages>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_scripts: ConfigItem<oxvg_optimiser::RemoveScripts>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_style_element: ConfigItem<oxvg_optimiser::RemoveStyleElement>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_title: ConfigItem<oxvg_optimiser::RemoveTitle>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_view_box: ConfigItem<oxvg_optimiser::RemoveViewBox>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub reuse_paths: ConfigItem<()>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_doctype: ConfigItem<oxvg_optimiser::RemoveDoctype>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_xml_proc_inst: ConfigItem<oxvg_optimiser::RemoveXMLProcInst>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_comments: ConfigItem<oxvg_optimiser::RemoveComments>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_deprecated_attrs: ConfigItem<oxvg_optimiser::RemoveDeprecatedAttrs>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_metadata: ConfigItem<oxvg_optimiser::RemoveMetadata>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub cleanup_attributes: ConfigItem<oxvg_optimiser::CleanupAttributes>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub merge_styles: ConfigItem<()>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub inline_styles: ConfigItem<oxvg_optimiser::inline_styles::Options>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub minify_styles: ConfigItem<oxvg_optimiser::MinifyStyles>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub cleanup_ids: ConfigItem<oxvg_optimiser::cleanup_ids::Options>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_useless_defs: ConfigItem<oxvg_optimiser::RemoveUselessDefs>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub cleanup_numeric_values: ConfigItem<oxvg_optimiser::CleanupNumericValues>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub convert_colors: ConfigItem<oxvg_optimiser::ConvertColors>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_unknowns_and_defaults: ConfigItem<oxvg_optimiser::RemoveUnknownsAndDefaults>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_non_inheritable_group_attrs:
    ConfigItem<oxvg_optimiser::RemoveNonInheritableGroupAttrs>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_useless_stroke_and_fill: ConfigItem<oxvg_optimiser::RemoveUselessStrokeAndFill>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub cleanup_enable_background: ConfigItem<oxvg_optimiser::CleanupEnableBackground>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_hidden_elems: ConfigItem<oxvg_optimiser::remove_hidden_elems::Options>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_empty_text: ConfigItem<oxvg_optimiser::RemoveEmptyText>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub convert_shape_to_path: ConfigItem<oxvg_optimiser::ConvertShapeToPath>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub convert_ellipse_to_circle: ConfigItem<oxvg_optimiser::ConvertEllipseToCircle>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub move_elems_attrs_to_group: ConfigItem<oxvg_optimiser::MoveElemsAttrsToGroup>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub move_group_attrs_to_elems: ConfigItem<oxvg_optimiser::MoveGroupAttrsToElems>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub collapse_groups: ConfigItem<oxvg_optimiser::CollapseGroups>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub apply_transforms: ConfigItem<oxvg_optimiser::ApplyTransforms>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub convert_path_data: ConfigItem<oxvg_optimiser::ConvertPathData>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub convert_transform: ConfigItem<oxvg_optimiser::ConvertTransform>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_empty_attrs: ConfigItem<oxvg_optimiser::RemoveEmptyAttrs>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_empty_containers: ConfigItem<oxvg_optimiser::RemoveEmptyContainers>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub merge_paths: ConfigItem<oxvg_optimiser::MergePaths>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub sort_attrs: ConfigItem<oxvg_optimiser::SortAttrs>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub sort_defs_children: ConfigItem<oxvg_optimiser::SortDefsChildren>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_desc: ConfigItem<oxvg_optimiser::RemoveDesc>,
}

#[derive(Deserialize, Debug)]
#[serde(transparent)]
pub struct DefaultTrue(bool);

impl Default for DefaultTrue {
  fn default() -> Self {
    DefaultTrue(true)
  }
}

#[derive(Deserialize, Default, Debug)]
#[serde(untagged)]
pub enum ConfigItem<C> {
  #[serde(skip)]
  #[default]
  None,
  Bool(bool),
  Config(C),
}

impl<C> ConfigItem<C> {
  fn is_some(&self) -> bool {
    match self {
      ConfigItem::Bool(true) => true,
      ConfigItem::Config(_) => true,
      _ => false,
    }
  }
}

fn ok_or_default<'de, T, D>(deserializer: D) -> Result<T, D::Error>
where
  T: serde::Deserialize<'de> + Default,
  D: serde::Deserializer<'de>,
{
  Ok(T::deserialize(deserializer).unwrap_or_default())
}

pub enum OxvgKind {
  Html,
  Svg,
}

impl OxvgConfig {
  pub fn into_jobs<'arena>(&self, kind: OxvgKind) -> oxvg_optimiser::Jobs<OxvgNode<'arena>> {
    let mut jobs = if self.default.0 {
      match kind {
        OxvgKind::Html => {
          oxvg_optimiser::Jobs {
            // These defaults can break CSS selectors.
            convert_shape_to_path: None,
            // Additional defaults to preserve accessibility information.
            remove_title: None,
            remove_desc: None,
            remove_unknowns_and_defaults: Some(oxvg_optimiser::RemoveUnknownsAndDefaults {
              keep_aria_attrs: true,
              keep_role_attr: true,
              ..Default::default()
            }),
            // Do not minify ids or remove unreferenced elements in
            // inline SVGs because they could actually be referenced
            // by a separate inline SVG.
            cleanup_ids: None,
            remove_hidden_elems: None,
            ..Default::default()
          }
        }
        OxvgKind::Svg => {
          oxvg_optimiser::Jobs {
            // Removing ids could break SVG sprites.
            cleanup_ids: None,
            ..Default::default()
          }
        }
      }
    } else {
      oxvg_optimiser::Jobs {
        add_attributes_to_svg_element: None,
        add_classes_to_svg: None,
        cleanup_list_of_values: None,
        prefix_ids: None,
        remove_attributes_by_selector: None,
        remove_attrs: None,
        remove_dimensions: None,
        remove_elements_by_attr: None,
        remove_off_canvas_paths: None,
        remove_raster_images: None,
        remove_scripts: None,
        remove_style_element: None,
        remove_title: None,
        remove_view_box: None,
        reuse_paths: None,
        remove_doctype: None,
        remove_xml_proc_inst: None,
        remove_comments: None,
        remove_deprecated_attrs: None,
        remove_metadata: None,
        cleanup_attributes: None,
        merge_styles: None,
        inline_styles: None,
        minify_styles: None,
        cleanup_ids: None,
        remove_useless_defs: None,
        cleanup_numeric_values: None,
        convert_colors: None,
        remove_unknowns_and_defaults: None,
        remove_non_inheritable_group_attrs: None,
        remove_useless_stroke_and_fill: None,
        cleanup_enable_background: None,
        remove_hidden_elems: None,
        remove_empty_text: None,
        convert_shape_to_path: None,
        convert_ellipse_to_circle: None,
        move_elems_attrs_to_group: None,
        move_group_attrs_to_elems: None,
        collapse_groups: None,
        apply_transforms: None,
        convert_path_data: None,
        convert_transform: None,
        remove_empty_attrs: None,
        remove_empty_containers: None,
        merge_paths: None,
        sort_attrs: None,
        sort_defs_children: None,
        remove_desc: None,
      }
    };

    macro_rules! job {
      ($name: ident) => {
        jobs.$name = match &self.$name {
          ConfigItem::None => jobs.$name,
          ConfigItem::Bool(true) => Some(Default::default()),
          ConfigItem::Bool(false) => None,
          ConfigItem::Config(c) => Some(c.clone().into()),
        };
      };
    }

    job!(add_attributes_to_svg_element);
    job!(add_classes_to_svg);
    job!(cleanup_list_of_values);

    jobs.prefix_ids = match &self.prefix_ids {
      ConfigItem::None => jobs.prefix_ids,
      ConfigItem::Bool(true) => Some(Default::default()),
      ConfigItem::Bool(false) => None,
      ConfigItem::Config(c) => Some(oxvg_optimiser::PrefixIds {
        delim: c
          .delim
          .as_ref()
          .map(|c| c.clone())
          .unwrap_or_else(|| oxvg_optimiser::PrefixIds::<OxvgNode>::default().delim),
        prefix: match &c.prefix {
          None => Default::default(),
          Some(c) => oxvg_optimiser::prefix_ids::PrefixGenerator::Prefix(c.clone()),
        },
        prefix_ids: c
          .prefix_ids
          .unwrap_or_else(|| oxvg_optimiser::PrefixIds::<OxvgNode>::default().prefix_ids),
        prefix_class_names: c
          .prefix_class_names
          .unwrap_or_else(|| oxvg_optimiser::PrefixIds::<OxvgNode>::default().prefix_class_names),
      }),
    };

    job!(remove_attributes_by_selector);
    job!(remove_attrs);
    job!(remove_dimensions);
    job!(remove_elements_by_attr);
    job!(remove_off_canvas_paths);
    job!(remove_raster_images);
    job!(remove_scripts);
    job!(remove_style_element);
    job!(remove_title);
    job!(remove_view_box);

    jobs.reuse_paths = match self.reuse_paths {
      ConfigItem::None => jobs.reuse_paths,
      ConfigItem::Bool(true) => Some(Default::default()),
      ConfigItem::Bool(false) => None,
      ConfigItem::Config(()) => unreachable!(),
    };

    job!(remove_doctype);
    job!(remove_xml_proc_inst);
    job!(remove_comments);
    job!(remove_deprecated_attrs);
    job!(remove_metadata);
    job!(cleanup_attributes);

    jobs.merge_styles = match self.merge_styles {
      ConfigItem::None => jobs.merge_styles,
      ConfigItem::Bool(true) => Some(Default::default()),
      ConfigItem::Bool(false) => None,
      ConfigItem::Config(()) => unreachable!(),
    };

    job!(inline_styles);
    job!(minify_styles);
    job!(cleanup_ids);
    job!(remove_useless_defs);
    job!(cleanup_numeric_values);
    job!(convert_colors);
    job!(remove_unknowns_and_defaults);
    job!(remove_non_inheritable_group_attrs);
    job!(remove_useless_stroke_and_fill);
    job!(cleanup_enable_background);
    job!(remove_hidden_elems);
    job!(remove_empty_text);
    job!(convert_shape_to_path);
    job!(convert_ellipse_to_circle);
    job!(move_elems_attrs_to_group);
    job!(move_group_attrs_to_elems);
    job!(collapse_groups);
    job!(apply_transforms);
    job!(convert_path_data);
    job!(convert_transform);
    job!(remove_empty_attrs);
    job!(remove_empty_containers);
    job!(merge_paths);
    job!(sort_attrs);
    job!(sort_defs_children);
    job!(remove_desc);

    jobs
  }

  pub fn has_any_jobs(&self) -> bool {
    return self.default.0
      || self.add_attributes_to_svg_element.is_some()
      || self.add_classes_to_svg.is_some()
      || self.cleanup_list_of_values.is_some()
      || self.prefix_ids.is_some()
      || self.remove_attributes_by_selector.is_some()
      || self.remove_attrs.is_some()
      || self.remove_dimensions.is_some()
      || self.remove_elements_by_attr.is_some()
      || self.remove_off_canvas_paths.is_some()
      || self.remove_raster_images.is_some()
      || self.remove_scripts.is_some()
      || self.remove_style_element.is_some()
      || self.remove_title.is_some()
      || self.remove_view_box.is_some()
      || self.reuse_paths.is_some()
      || self.remove_doctype.is_some()
      || self.remove_xml_proc_inst.is_some()
      || self.remove_comments.is_some()
      || self.remove_deprecated_attrs.is_some()
      || self.remove_metadata.is_some()
      || self.cleanup_attributes.is_some()
      || self.merge_styles.is_some()
      || self.inline_styles.is_some()
      || self.minify_styles.is_some()
      || self.cleanup_ids.is_some()
      || self.remove_useless_defs.is_some()
      || self.cleanup_numeric_values.is_some()
      || self.convert_colors.is_some()
      || self.remove_unknowns_and_defaults.is_some()
      || self.remove_non_inheritable_group_attrs.is_some()
      || self.remove_useless_stroke_and_fill.is_some()
      || self.cleanup_enable_background.is_some()
      || self.remove_hidden_elems.is_some()
      || self.remove_empty_text.is_some()
      || self.convert_shape_to_path.is_some()
      || self.convert_ellipse_to_circle.is_some()
      || self.move_elems_attrs_to_group.is_some()
      || self.move_group_attrs_to_elems.is_some()
      || self.collapse_groups.is_some()
      || self.apply_transforms.is_some()
      || self.convert_path_data.is_some()
      || self.convert_transform.is_some()
      || self.remove_empty_attrs.is_some()
      || self.remove_empty_containers.is_some()
      || self.merge_paths.is_some()
      || self.sort_attrs.is_some()
      || self.sort_defs_children.is_some()
      || self.remove_desc.is_some();
  }
}
