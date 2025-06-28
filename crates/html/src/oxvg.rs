use std::{
  borrow::Cow,
  cell::{Cell, RefCell, RefMut},
  collections::VecDeque,
  fmt::Debug,
  hash::Hash,
};

use crate::arena::{Arena, Node, NodeData, Ref, SelectorFlags};
use ref_cast::RefCast;
use serde::Deserialize;
use xml5ever::{Attribute, QualName, local_name, tendril::StrTendril};

use oxvg_ast::{attribute::Attr as _, element::Element as _, name::Name, node::Node as _};

impl<'arena> oxvg_ast::node::Node<'arena> for Ref<'arena> {
  type Arena = Arena<'arena>;
  type Name = QName;
  type Atom = StrTendril;
  type Child = Ref<'arena>;
  type ParentChild = Ref<'arena>;
  type Parent = Element<'arena>;

  fn id(&self) -> usize {
    *self as *const _ as usize
  }

  fn child_nodes_iter(&self) -> impl DoubleEndedIterator<Item = Self::Child> {
    ChildNodes {
      front: self.first_child(),
      end: self.last_child(),
    }
  }

  #[allow(refining_impl_trait)]
  fn element(&self) -> Option<Element<'arena>> {
    match self.node_type() {
      oxvg_ast::node::Type::Element | oxvg_ast::node::Type::Document => Element::new(*self),
      _ => None,
    }
  }

  fn empty(&self) {
    self.first_child.set(None);
    self.last_child.set(None);
  }

  #[allow(refining_impl_trait)]
  fn find_element(&self) -> Option<Element<'arena>> {
    <Element as oxvg_ast::element::Element<'arena>>::find_element(*self)
  }

  fn first_child(&self) -> Option<Self::Child> {
    self.first_child.get()
  }

  fn insert_before(&mut self, new_node: Self::Child, reference_node: &Self::Child) {
    new_node.remove();
    new_node.parent.set(Some(self));
    let Some(prev_child) = reference_node.previous_sibling.replace(Some(new_node)) else {
      self.first_child.set(Some(new_node));
      new_node.next_sibling.set(Some(reference_node));
      return;
    };
    prev_child.next_sibling.set(Some(new_node));
    new_node.previous_sibling.set(Some(prev_child));
    new_node.next_sibling.set(Some(reference_node));
    debug_assert!(new_node.parent.get() == Some(*self));
    debug_assert!(new_node.next_sibling.get() == Some(*reference_node));
    debug_assert!(reference_node.previous_sibling.get() == Some(new_node));
  }

  fn insert_after(&mut self, new_node: Self::Child, reference_node: &Self::Child) {
    new_node.remove();
    new_node.parent.set(Some(self));
    let Some(next_child) = reference_node.next_sibling.replace(Some(new_node)) else {
      self.last_child.set(Some(new_node));
      new_node.previous_sibling.set(Some(reference_node));
      return;
    };
    next_child.previous_sibling.set(Some(new_node));
    new_node.next_sibling.set(Some(next_child));
    new_node.previous_sibling.set(Some(reference_node));
    debug_assert!(new_node.parent.get() == Some(*self));
    debug_assert!(new_node.previous_sibling.get() == Some(*reference_node));
    debug_assert!(reference_node.next_sibling.get() == Some(new_node));
  }

  fn retain_children<F>(&self, mut f: F)
  where
    F: FnMut(Self::Child) -> bool,
  {
    self.last_child.set(None);
    let mut current = self.first_child.take();
    let mut previously_retained = None;
    while let Some(child) = current {
      current = child.next_sibling.get();
      let retain = f(child);
      if retain {
        child.previous_sibling.set(previously_retained);
        if previously_retained.is_none() {
          self.first_child.set(Some(child));
        }
        previously_retained = Some(child);
        self.last_child.set(Some(child));
      } else {
        child.parent.set(None);
        child.previous_sibling.set(None);
        child.next_sibling.set(None);
      }
    }
  }

  fn last_child(&self) -> Option<Self::Child> {
    self.last_child.get()
  }

  fn next_sibling(&self) -> Option<Self::ParentChild> {
    self.next_sibling.get()
  }

  fn node_type(&self) -> oxvg_ast::node::Type {
    match &self.data {
      NodeData::Document => oxvg_ast::node::Type::Document,
      NodeData::Element { .. } => oxvg_ast::node::Type::Element,
      NodeData::ProcessingInstruction { .. } => oxvg_ast::node::Type::ProcessingInstruction,
      NodeData::Text { .. } => oxvg_ast::node::Type::Text,
      NodeData::Comment { .. } => oxvg_ast::node::Type::Comment,
      NodeData::Doctype { .. } => oxvg_ast::node::Type::DocumentType,
    }
  }

  fn previous_sibling(&self) -> Option<Self::ParentChild> {
    self.previous_sibling.get()
  }

  fn parent_node(&self) -> Option<Self::Parent> {
    self.parent.get().and_then(Element::new)
  }

  fn set_parent_node(&self, new_parent: &Self::Parent) -> Option<Self::Parent> {
    self
      .parent
      .replace(Some(new_parent.node))
      .and_then(Element::new)
  }

  fn append_child(&self, a_child: Self::Child) {
    a_child.parent.set(Some(self));
    if let Some(child) = self.last_child.replace(Some(a_child)) {
      child.next_sibling.set(Some(a_child));
      a_child.previous_sibling.set(Some(child));
    } else {
      self.first_child.set(Some(a_child));
    }
    debug_assert!(a_child.parent.get() == Some(*self));
    debug_assert!(a_child.next_sibling.get().is_none());
    debug_assert!(self.last_child.get() == Some(a_child));
  }

  fn item(&self, index: usize) -> Option<Self::Child> {
    self.child_nodes_iter().nth(index)
  }

  fn node_name(&self) -> Self::Atom {
    match &self.data {
      NodeData::Comment { .. } => "#comment".into(),
      NodeData::Doctype { name, .. } => name.clone(),
      NodeData::Document => "#document".into(),
      NodeData::Element { name, .. } => name.local.to_uppercase().into(),
      NodeData::ProcessingInstruction { target, .. } => target.clone(),
      NodeData::Text { .. } => "#text".into(),
    }
  }

  fn node_value(&self) -> Option<Self::Atom> {
    Some(match &self.data {
      NodeData::Comment { contents } => contents.clone(),
      NodeData::ProcessingInstruction { contents, .. } => contents.borrow().clone(),
      NodeData::Text { contents } => contents.borrow().clone(),
      _ => return None,
    })
  }

  fn processing_instruction(&self) -> Option<(Self::Atom, Self::Atom)> {
    match &self.data {
      NodeData::ProcessingInstruction { target, contents } => {
        Some((target.clone(), contents.borrow().clone()))
      }
      _ => None,
    }
  }

  fn try_set_node_value(&self, value: Self::Atom) -> Option<()> {
    match &self.data {
      NodeData::Text { contents } => {
        contents.replace(value);
        Some(())
      }
      _ => None,
    }
  }

  fn text_content(&self) -> Option<Self::Atom> {
    match &self.data {
      NodeData::Text { contents: value }
      | NodeData::ProcessingInstruction {
        contents: value, ..
      } => Some(value.borrow().clone()),
      NodeData::Comment { contents: value } => Some(value.clone()),
      NodeData::Document | NodeData::Doctype { .. } => None,
      NodeData::Element { .. } => Some(
        self
          .child_nodes_iter()
          .filter_map(|el| Self::text_content(&el))
          .fold(StrTendril::default(), |mut acc, item| {
            acc.push_tendril(&item);
            acc
          }),
      ),
    }
  }

  fn set_text_content(&self, content: Self::Atom, arena: &Self::Arena) {
    match self.data {
      NodeData::Text { ref contents } => {
        contents.replace(content);
      }
      NodeData::Element { .. } => {
        self.empty();
        self.append_child(self.text(content, arena));
      }
      _ => {}
    }
  }

  fn text(&self, content: Self::Atom, arena: &Self::Arena) -> Self::Child {
    arena.alloc(Node::new(
      NodeData::Text {
        contents: RefCell::new(content),
      },
      0,
    ))
  }

  fn remove(&self) {
    let parent = self.parent.take();
    let previous_sibling = self.previous_sibling.take();
    let next_sibling = self.next_sibling.take();
    if let Some(previous_sibling) = previous_sibling {
      if let Some(next_sibling) = next_sibling {
        // prev -> ~self~ -> next
        next_sibling.previous_sibling.set(Some(previous_sibling));
      } else if let Some(parent) = parent {
        // prev -> ~self~ -> None
        parent.last_child.set(Some(previous_sibling));
      }
      previous_sibling.next_sibling.set(next_sibling);
    } else if let Some(next_sibling) = next_sibling {
      next_sibling.previous_sibling.set(None);
      if let Some(parent) = parent {
        // None -> ~self~ -> next
        parent.first_child.set(Some(next_sibling));
      }
    } else if let Some(parent) = parent {
      // None -> ~self~ -> None
      parent.first_child.set(None);
      parent.last_child.set(None);
    }
    debug_assert!(previous_sibling.is_none_or(|n| n.next_sibling.get() == next_sibling));
    debug_assert!(next_sibling.is_none_or(|n| n.previous_sibling.get() == previous_sibling));
    debug_assert!(parent.is_none_or(|n| n.first_child.get() != Some(*self)));
    debug_assert!(parent.is_none_or(|n| n.last_child.get() != Some(*self)));
  }

  fn remove_child_at(&mut self, index: usize) -> Option<Self::Child> {
    let child = self.child_nodes_iter().nth(index);
    child?.remove();
    child
  }

  fn clone_node(&self) -> Self {
    todo!("needs arena")
  }

  fn replace_child(
    &mut self,
    new_child: Self::Child,
    old_child: &Self::Child,
  ) -> Option<Self::Child> {
    debug_assert_eq!(old_child.parent.get(), Some(*self));
    // debug_assert!(self.child_nodes_iter().contains(old_child));

    let previous_sibling = old_child.previous_sibling.take();
    let next_sibling = old_child.next_sibling.take();
    old_child.parent.set(None);

    new_child.previous_sibling.set(previous_sibling);
    new_child.next_sibling.set(next_sibling);
    new_child.parent.set(Some(*self));

    if let Some(previous_sibling) = previous_sibling {
      previous_sibling.next_sibling.set(Some(new_child));
    } else {
      self.first_child.set(Some(new_child));
    }
    if let Some(next_sibling) = next_sibling {
      next_sibling.previous_sibling.set(Some(new_child));
    } else {
      self.last_child.set(Some(new_child));
    }
    Some(*old_child)
  }

  // TODO: deprecate
  fn to_owned(&self) -> Self {
    self
  }

  fn as_child(&self) -> Self::Child {
    self
  }

  fn as_impl(&self) -> impl oxvg_ast::node::Node<'arena> {
    *self
  }

  fn as_parent_child(&self) -> Self::ParentChild {
    self
  }
}

#[derive(RefCast, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Clone)]
#[repr(transparent)]
pub struct QName(QualName);

impl oxvg_ast::name::Name for QName {
  type LocalName = xml5ever::LocalName;
  type Prefix = xml5ever::Prefix;
  type Namespace = xml5ever::Namespace;

  fn new(prefix: Option<Self::Prefix>, local: Self::LocalName) -> Self {
    QName(QualName {
      prefix,
      local,
      ns: Self::Namespace::default(),
    })
  }

  fn local_name(&self) -> &Self::LocalName {
    &self.0.local
  }

  fn prefix(&self) -> &Option<Self::Prefix> {
    &self.0.prefix
  }

  fn ns(&self) -> &Self::Namespace {
    &self.0.ns
  }
}

#[derive(RefCast, Clone, Debug, PartialEq)]
#[repr(transparent)]
pub struct Attr(Attribute);

impl<'arena> oxvg_ast::attribute::Attr for Attr {
  type Atom = StrTendril;
  type Name = QName;

  fn new(name: Self::Name, value: Self::Atom) -> Self {
    Attr(Attribute {
      name: name.0,
      value,
    })
  }

  fn name(&self) -> &Self::Name {
    QName::ref_cast(&self.0.name)
  }

  fn name_mut(&mut self) -> &mut Self::Name {
    QName::ref_cast_mut(&mut self.0.name)
  }

  fn local_name(&self) -> &<Self::Name as Name>::LocalName {
    &self.0.name.local
  }

  fn prefix(&self) -> &Option<<Self::Name as Name>::Prefix> {
    &self.0.name.prefix
  }

  fn value(&self) -> &Self::Atom {
    &self.0.value
  }

  fn value_mut(&mut self) -> &mut Self::Atom {
    &mut self.0.value
  }

  fn set_value(&mut self, value: Self::Atom) -> Self::Atom {
    std::mem::replace(&mut self.0.value, value)
  }

  fn push(&mut self, value: &Self::Atom) {
    self.0.value.push_tendril(value);
  }

  fn sub_value(&self, offset: u32, length: u32) -> Self::Atom {
    self.0.value.subtendril(offset, length)
  }
}
#[derive(Debug, Clone)]
/// The list of attributes of an element.
pub struct Attributes<'arena>(pub &'arena RefCell<Vec<Attribute>>);

impl<'arena> oxvg_ast::attribute::Attributes<'arena> for Attributes<'arena> {
  type Attribute = Attr;

  fn len(&self) -> usize {
    self.0.borrow().len()
  }

  fn item(&self, index: usize) -> Option<std::cell::Ref<'arena, Self::Attribute>> {
    std::cell::Ref::filter_map(self.0.borrow(), |v| v.get(index).map(Attr::ref_cast)).ok()
  }

  fn item_mut(&self, index: usize) -> Option<std::cell::RefMut<'arena, Self::Attribute>> {
    std::cell::RefMut::filter_map(self.0.borrow_mut(), |v| {
      v.get_mut(index).map(Attr::ref_cast_mut)
    })
    .ok()
  }

  fn get_named_item(
    &self,
    name: &<Self::Attribute as oxvg_ast::attribute::Attr>::Name,
  ) -> Option<std::cell::Ref<'arena, Self::Attribute>> {
    std::cell::Ref::filter_map(self.0.borrow(), |v| {
      v.iter()
        .find(|a| a.name.prefix == *name.prefix() && a.name.local == *name.local_name())
        .map(Attr::ref_cast)
    })
    .ok()
  }

  fn get_named_item_mut(
    &self,
    name: &<Self::Attribute as oxvg_ast::attribute::Attr>::Name,
  ) -> Option<RefMut<'arena, Self::Attribute>> {
    RefMut::filter_map(self.0.borrow_mut(), |v| {
      v.iter_mut()
        .find(|a| a.name.prefix == *name.prefix() && a.name.local == *name.local_name())
        .map(Attr::ref_cast_mut)
    })
    .ok()
  }

  fn get_named_item_local(
    &self,
    name: &<<Self::Attribute as oxvg_ast::attribute::Attr>::Name as Name>::LocalName,
  ) -> Option<std::cell::Ref<'arena, Self::Attribute>> {
    std::cell::Ref::filter_map(self.0.borrow(), |v| {
      v.iter()
        .find(|a| a.name.prefix.is_none() && a.name.local == *name)
        .map(Attr::ref_cast)
    })
    .ok()
  }

  fn get_named_item_local_mut(
    &self,
    name: &<<Self::Attribute as oxvg_ast::attribute::Attr>::Name as Name>::LocalName,
  ) -> Option<RefMut<'arena, Self::Attribute>> {
    RefMut::filter_map(self.0.borrow_mut(), |v| {
      v.iter_mut()
        .find(|a| a.name.prefix.is_none() && a.name.local == *name)
        .map(Attr::ref_cast_mut)
    })
    .ok()
  }

  fn get_named_item_ns(
    &self,
    namespace: &<<Self::Attribute as oxvg_ast::attribute::Attr>::Name as Name>::Namespace,
    name: &<<Self::Attribute as oxvg_ast::attribute::Attr>::Name as Name>::LocalName,
  ) -> Option<std::cell::Ref<'arena, Self::Attribute>> {
    std::cell::Ref::filter_map(self.0.borrow(), |v| {
      v.iter()
        .find(|a| a.name.local == *name && a.name.ns == *namespace)
        .map(Attr::ref_cast)
    })
    .ok()
  }

  fn remove_named_item(
    &self,
    name: &<Self::Attribute as oxvg_ast::attribute::Attr>::Name,
  ) -> Option<Self::Attribute> {
    let mut attrs = self.0.borrow_mut();
    let index = attrs
      .iter()
      .position(|a| a.name.prefix == *name.prefix() && a.name.local == *name.local_name())?;
    Some(Attr(attrs.remove(index)))
  }

  fn remove_named_item_local(
    &self,
    name: &<<Self::Attribute as oxvg_ast::attribute::Attr>::Name as Name>::LocalName,
  ) -> Option<Self::Attribute> {
    let mut attrs = self.0.borrow_mut();
    let index = attrs
      .iter()
      .position(|a| a.name.prefix.is_none() && a.name.local == *name)?;
    Some(Attr(attrs.remove(index)))
  }

  fn set_named_item(&self, attr: Self::Attribute) -> Option<Self::Attribute> {
    let attrs = &mut *self.0.borrow_mut();
    if let Some(index) = attrs
      .iter()
      .position(|a| a.name.prefix == *attr.prefix() && a.name.local == *attr.local_name())
    {
      Some(Attr(std::mem::replace(&mut attrs[index], attr.0)))
    } else {
      attrs.push(attr.0);
      None
    }
  }

  fn sort(&self, order: &[String], xmlns_front: bool) {
    fn get_ns_priority(name: &QualName, xmlns_front: bool) -> usize {
      if xmlns_front {
        if name.prefix.is_none() && name.local.as_ref() == "xmlns" {
          return 3;
        }
        if name.prefix.as_ref().is_some_and(|p| p.as_ref() == "xmlns") {
          return 2;
        }
      }
      if name.prefix.is_some() {
        return 1;
      }
      0
    }

    self.0.borrow_mut().sort_by(|a, b| {
      let a_priority = get_ns_priority(&a.name, xmlns_front);
      let b_priority = get_ns_priority(&b.name, xmlns_front);
      let priority_ord = b_priority.cmp(&a_priority);
      if priority_ord != std::cmp::Ordering::Equal {
        return priority_ord;
      }

      let a_part = a
        .name
        .local
        .split_once('-')
        .map_or_else(|| a.name.local.as_ref(), |p| p.0);
      let b_part = b
        .name
        .local
        .split_once('-')
        .map_or_else(|| b.name.local.as_ref(), |p| p.0);
      if a_part != b_part {
        let a_in_order = order.iter().position(|x| x == a_part);
        let b_in_order = order.iter().position(|x| x == b_part);
        if a_in_order.is_some() && b_in_order.is_some() {
          return a_in_order.cmp(&b_in_order);
        }
        if a_in_order.is_some() {
          return std::cmp::Ordering::Less;
        }
        if b_in_order.is_some() {
          return std::cmp::Ordering::Greater;
        }
      }

      a.name.cmp(&b.name)
    });
  }

  fn retain<F>(&self, mut f: F)
  where
    F: FnMut(&Self::Attribute) -> bool,
  {
    self.0.borrow_mut().retain(|attr| f(Attr::ref_cast(attr)));
  }
}

impl<'arena> oxvg_ast::node::Node<'arena> for Element<'arena> {
  type Arena = Arena<'arena>;
  type Name = QName;
  type Atom = StrTendril;
  type Child = Ref<'arena>;
  type ParentChild = Ref<'arena>;
  type Parent = Element<'arena>;

  fn id(&self) -> usize {
    self.node.id()
  }

  fn child_nodes_iter(&self) -> impl DoubleEndedIterator<Item = Self::Child> {
    self.node.child_nodes_iter()
  }

  fn element(&self) -> Option<impl oxvg_ast::element::Element<'arena, Name = QName>> {
    Some(self.clone())
  }

  fn empty(&self) {
    self.node.empty();
  }

  #[allow(refining_impl_trait)]
  fn find_element(&self) -> Option<Self> {
    if self.node_type() == oxvg_ast::node::Type::Element {
      Some(self.clone())
    } else {
      self.node.find_element()
    }
  }

  fn first_child(&self) -> Option<Self::Child> {
    self.node.first_child()
  }

  fn insert_before(&mut self, new_node: Self::Child, reference_node: &Self::Child) {
    oxvg_ast::node::Node::insert_before(&mut self.node, new_node, reference_node);
  }

  fn insert_after(&mut self, new_node: Self::Child, reference_node: &Self::Child) {
    oxvg_ast::node::Node::insert_after(&mut self.node, new_node, reference_node);
  }

  fn retain_children<F>(&self, f: F)
  where
    F: FnMut(Self::Child) -> bool,
  {
    self.node.retain_children(f);
  }

  fn last_child(&self) -> Option<Self::Child> {
    self.node.last_child()
  }

  fn node_type(&self) -> oxvg_ast::node::Type {
    self.node.node_type()
  }

  fn next_sibling(&self) -> Option<Self::ParentChild> {
    self.node.next_sibling()
  }

  fn parent_node(&self) -> Option<Self::Parent> {
    self.node.parent_node()
  }

  fn previous_sibling(&self) -> Option<Self::ParentChild> {
    self.node.previous_sibling()
  }

  fn set_parent_node(&self, new_parent: &Self::Parent) -> Option<Self::Parent> {
    self.node.set_parent_node(new_parent)
  }

  fn append_child(&self, a_child: Self::Child) {
    self.node.append_child(a_child);
  }

  fn item(&self, index: usize) -> Option<Self::Child> {
    self.node.item(index)
  }

  fn node_name(&self) -> Self::Atom {
    self.node.node_name()
  }

  fn node_value(&self) -> Option<Self::Atom> {
    None
  }

  fn processing_instruction(&self) -> Option<(Self::Atom, Self::Atom)> {
    None
  }

  fn try_set_node_value(&self, _value: Self::Atom) -> Option<()> {
    None
  }

  fn text_content(&self) -> Option<Self::Atom> {
    oxvg_ast::node::Node::text_content(&self.node)
  }

  fn set_text_content(&self, content: Self::Atom, arena: &Self::Arena) {
    oxvg_ast::node::Node::set_text_content(&self.node, content, arena);
  }

  fn text(&self, content: Self::Atom, arena: &Self::Arena) -> Self::Child {
    self.node.text(content, arena)
  }

  fn remove(&self) {
    self.node.remove();
  }

  fn remove_child_at(&mut self, index: usize) -> Option<Self::Child> {
    self.node.remove_child_at(index)
  }

  fn clone_node(&self) -> Self {
    oxvg_ast::element::Element::new(self.node.clone_node()).unwrap()
  }

  fn replace_child(
    &mut self,
    new_child: Self::Child,
    old_child: &Self::Child,
  ) -> Option<Self::Child> {
    self.node.replace_child(new_child, old_child)
  }

  fn to_owned(&self) -> Self {
    self.clone()
  }

  fn as_child(&self) -> Self::Child {
    self.node.as_child()
  }

  fn as_impl(&self) -> impl oxvg_ast::node::Node<'arena> {
    self.node.as_impl()
  }

  fn as_parent_child(&self) -> Self::ParentChild {
    self.node.as_parent_child()
  }
}

#[derive(Clone)]
/// An XML element type.
pub struct Element<'arena> {
  node: Ref<'arena>,
}

impl<'arena> oxvg_ast::element::Element<'arena> for Element<'arena> {
  type Attributes<'a> = Attributes<'a>;
  type Attr = Attr;
  type Lifetimed<'a> = Element<'a>;

  fn new(node: Ref<'arena>) -> Option<Self> {
    if !matches!(
      node.node_type(),
      oxvg_ast::node::Type::Element | oxvg_ast::node::Type::Document
    ) {
      return None;
    }
    Some(Self { node })
  }

  fn as_document(&self) -> impl oxvg_ast::document::Document<'arena, Root = Self> {
    Document(self.clone())
  }

  fn from_parent(node: Self::ParentChild) -> Option<Self> {
    Self::new(node)
  }

  fn tag_name(&self) -> Self::Atom {
    self.node.node_name()
  }

  fn qual_name(&self) -> &Self::Name {
    if let NodeData::Element { name, .. } = &self.node.data {
      QName::ref_cast(&name)
    } else {
      unreachable!()
    }
  }

  fn replace_children(&self, children: Vec<Self::Child>) {
    self.node.first_child.set(children.first().copied());
    self.node.last_child.set(children.last().copied());
    for i in 0..children.len() {
      let current = children.get(i).expect("`i` should be within len");
      current.parent.set(Some(self.node));
      if i > 0 {
        current.previous_sibling.set(children.get(i - 1).copied());
      } else {
        current.previous_sibling.set(None);
      }
      current.next_sibling.set(children.get(i + 1).copied());
    }
  }

  fn set_local_name(&self, new_name: <Self::Name as Name>::LocalName, arena: &Self::Arena) {
    let NodeData::Element { attrs, .. } = &self.node.data else {
      panic!("expected an element!");
    };
    let replacement = arena.alloc(Node::new(
      NodeData::Element {
        name: QualName::new(None, Default::default(), new_name),
        attrs: attrs.clone(),
        selector_flags: SelectorFlags(Cell::new(None)),
        mathml_annotation_xml_integration_point: false,
        template_contents: None,
      },
      0,
    ));
    self.replace_with(replacement);
  }

  fn append(&self, node: Self::Child) {
    node.remove();
    if let Some(last_node) = self.node.last_child.get() {
      last_node.next_sibling.set(Some(node));
      self.node.last_child.set(Some(node));
    } else {
      debug_assert!(self.node.first_child.get().is_none());
      self.node.first_child.set(Some(node));
      self.node.last_child.set(Some(node));
    }
  }

  fn attributes(&self) -> Self::Attributes<'_> {
    if let NodeData::Element { attrs, .. } = &self.node.data {
      Attributes(attrs)
    } else {
      unreachable!()
    }
  }

  fn set_attributes(&self, new_attrs: Self::Attributes<'_>) {
    if let NodeData::Element { attrs, .. } = &self.node.data {
      attrs.replace(new_attrs.0.take());
    }
  }

  fn parent_element(&self) -> Option<Self> {
    self.node.parent_node()
  }

  fn class_list(
    &self,
  ) -> impl oxvg_ast::class_list::ClassList<
    Attribute = <Self::Attributes<'_> as oxvg_ast::attribute::Attributes>::Attribute,
  > {
    use oxvg_ast::attribute::Attributes;
    ClassList {
      attrs: self.attributes(),
      tokens: self
        .attributes()
        .get_named_item_local(&local_name!("class"))
        .map(|a| a.value().split_whitespace().map(Into::into).collect())
        .unwrap_or_default(),
    }
  }

  fn document(&self) -> Option<Self> {
    let Some(parent) = self.parent_node() else {
      return Some(self.clone());
    };
    match self.node.data {
      NodeData::Element { .. } => parent.document(),
      NodeData::Document => Some(parent),
      _ => None,
    }
  }

  fn flatten(&self) {
    let parent = self.node.parent.take();
    let mut current = self.node.first_child.get();
    while let Some(current_child) = current {
      current_child.parent.set(parent);
      current = current_child.next_sibling.get();
    }

    let previous_sibling = self.node.previous_sibling.take();
    let next_sibling = self.node.next_sibling.take();
    let first_child = self.node.first_child.take();
    let last_child = self.node.last_child.take();

    if let Some(first_child) = first_child {
      if let Some(previous_sibling) = previous_sibling {
        previous_sibling.next_sibling.set(Some(first_child));
        first_child.previous_sibling.set(Some(previous_sibling));
      } else if let Some(parent) = parent {
        parent.first_child.set(Some(first_child));
      }
    } else if let Some(previous_sibling) = previous_sibling {
      previous_sibling.next_sibling.set(next_sibling);
      next_sibling.inspect(|n| n.previous_sibling.set(Some(previous_sibling)));
    } else if let Some(parent) = parent {
      parent.first_child.set(next_sibling);
    }
    if let Some(last_child) = last_child {
      if let Some(next_sibling) = next_sibling {
        last_child.next_sibling.set(Some(next_sibling));
        next_sibling.previous_sibling.set(Some(last_child));
      } else if let Some(parent) = parent {
        parent.last_child.set(Some(last_child));
      }
    } else if let Some(next_sibling) = next_sibling {
      next_sibling.previous_sibling.set(previous_sibling);
    } else if let Some(parent) = parent {
      parent.last_child.set(previous_sibling);
    }
  }

  fn find_element(node: <Self as oxvg_ast::node::Node<'arena>>::ParentChild) -> Option<Self> {
    let mut queue = VecDeque::new();
    queue.push_back(node);

    while let Some(current) = queue.pop_front() {
      let maybe_element = current.element();
      if maybe_element
        .as_ref()
        .is_some_and(|n| n.node_type() == oxvg_ast::node::Type::Element)
      {
        return maybe_element;
      }

      for child in current.child_nodes_iter() {
        queue.push_back(child);
      }
    }
    None
  }

  fn sort_child_elements<F>(&self, mut f: F)
  where
    F: FnMut(Self, Self) -> std::cmp::Ordering,
  {
    let mut children: Vec<_> = self.child_nodes_iter().collect();
    children.sort_by(|a, b| {
      let Some(a) = Element::new(a) else {
        return std::cmp::Ordering::Less;
      };
      let Some(b) = Element::new(b) else {
        return std::cmp::Ordering::Greater;
      };
      f(a, b)
    });

    self.node.first_child.set(children.first().copied());
    self.node.last_child.set(children.last().copied());
    for i in 0..children.len() {
      let child = children[i];
      if i > 0 {
        child.previous_sibling.set(children.get(i - 1).copied());
      }
      child.next_sibling.set(children.get(i + 1).copied());
    }
  }

  fn set_selector_flags(&self, flags: selectors::matching::ElementSelectorFlags) {
    let NodeData::Element {
      ref selector_flags, ..
    } = self.node.data
    else {
      return;
    };
    selector_flags.0.set(Some(flags));
  }
}

impl Debug for Element<'_> {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    if self.node_type() != oxvg_ast::node::Type::Element {
      return (&self.node).fmt(f);
    }
    let name = self.qual_name().formatter();
    let attributes = self.attributes();
    let child_node_count = self.child_node_count();
    let text = match child_node_count {
      1 => self
        .text_content()
        .map(|s| s.trim().to_string())
        .map(Cow::Owned)
        .unwrap_or_default(),
      _ => Cow::Borrowed(""),
    };
    let child_count = match child_node_count {
      0 => String::from("/>"),
      len => format!(">{len} child nodes</{name}>"),
    };
    f.debug_tuple("Element")
      .field(&format!("<{name} {attributes:?}{child_count} {text}"))
      .finish()
  }
}

impl std::hash::Hash for Element<'_> {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    self.node.id().hash(state);
  }
}

impl Eq for Element<'_> {}

impl PartialEq for Element<'_> {
  fn eq(&self, other: &Self) -> bool {
    self.id_eq(other)
  }
}

/// A whitespace seperated set of tokens of a class attribute's value.
pub struct ClassList<'arena> {
  attrs: Attributes<'arena>,
  tokens: Vec<StrTendril>,
}

impl oxvg_ast::class_list::ClassList for ClassList<'_> {
  type Attribute = Attr;

  fn length(&self) -> usize {
    self.tokens.len()
  }

  fn value(&self) -> <Self::Attribute as oxvg_ast::attribute::Attr>::Atom {
    use oxvg_ast::attribute::Attributes;
    self
      .attrs
      .get_named_item_local(&"class".into())
      .map(|a| a.value().clone())
      .unwrap_or_default()
  }

  fn add(&mut self, token: <Self::Attribute as oxvg_ast::attribute::Attr>::Atom) {
    use oxvg_ast::attribute::Attributes;
    if self.contains(&token) {
      return;
    };
    let Some(mut attr) = self.attrs.get_named_item_local_mut(&"class".into()) else {
      self
        .attrs
        .set_named_item(Attr::new(Name::new(None, "class".into()), token.clone()));
      self.tokens.push(token);
      return;
    };

    attr.push(&token);
  }

  fn contains(&self, token: &<Self::Attribute as oxvg_ast::attribute::Attr>::Atom) -> bool {
    self.tokens.contains(token)
  }

  fn item(&self, index: usize) -> Option<&<Self::Attribute as oxvg_ast::attribute::Attr>::Atom> {
    self.tokens.get(index)
  }

  fn remove(&mut self, token: &<Self::Attribute as oxvg_ast::attribute::Attr>::Atom) {
    use oxvg_ast::attribute::Attributes;
    let Some(index) = self.tokens.iter().position(|t| t == token) else {
      return;
    };
    self.tokens.remove(index);

    let mut attr = self
      .attrs
      .get_named_item_local_mut(&"class".into())
      .expect("had token");
    if self.tokens.is_empty() {
      drop(attr);
      self.attrs.remove_named_item_local(&"class".into());
    } else {
      let mut s = StrTendril::with_capacity(attr.value().len() as u32);
      let mut first = false;
      for token in &self.tokens {
        if !first {
          s.push_char(' ');
        }
        s.push_tendril(token);
        first = false;
      }
      attr.set_value(s);
    }
  }

  fn replace(
    &mut self,
    old_token: <Self::Attribute as oxvg_ast::attribute::Attr>::Atom,
    new_token: <Self::Attribute as oxvg_ast::attribute::Attr>::Atom,
  ) -> bool {
    use oxvg_ast::attribute::Attributes;
    let Some(index) = self.tokens.iter().position(|t| t == &old_token) else {
      return false;
    };

    let mut attr = self
      .attrs
      .get_named_item_local_mut(&"class".into())
      .expect("had token");

    let mut s = StrTendril::with_capacity(attr.value().len() as u32);
    let mut first = false;
    for token in &self.tokens {
      if !first {
        s.push_char(' ');
      }
      s.push_tendril(token);
      first = false;
    }
    attr.set_value(s);

    drop(attr);
    self.tokens[index] = new_token;
    true
  }

  fn iter(
    &self,
  ) -> impl DoubleEndedIterator<Item = &<Self::Attribute as oxvg_ast::attribute::Attr>::Atom> {
    self.tokens.iter()
  }
}

#[derive(Clone)]
/// An XML document type with a root element
pub struct Document<'arena>(Element<'arena>);

impl<'arena> oxvg_ast::document::Document<'arena> for Document<'arena> {
  type Root = Element<'arena>;

  fn document_element(&self) -> &Self::Root {
    &self.0
  }

  fn create_c_data_section(
    &self,
    data: <Self::Root as oxvg_ast::node::Node<'arena>>::Atom,
    arena: &<Self::Root as oxvg_ast::node::Node<'arena>>::Arena,
  ) -> <Self::Root as oxvg_ast::node::Node<'arena>>::Child {
    self.create_text_node(data, arena)
  }

  fn create_element(
    &self,
    tag_name: <Self::Root as oxvg_ast::node::Node<'arena>>::Name,
    arena: &<Self::Root as oxvg_ast::node::Node<'arena>>::Arena,
  ) -> Self::Root {
    Element::new(arena.alloc(Node::new(
      NodeData::Element {
        name: tag_name.0,
        attrs: RefCell::new(vec![]),
        selector_flags: SelectorFlags(Cell::new(None)),
        mathml_annotation_xml_integration_point: false,
        template_contents: None,
      },
      0,
    )))
    .expect("created element should be an element")
  }

  fn create_processing_instruction(
    &self,
    target: <Self::Root as oxvg_ast::node::Node<'arena>>::Atom,
    data: <Self::Root as oxvg_ast::node::Node<'arena>>::Atom,
    arena: &<Self::Root as oxvg_ast::node::Node<'arena>>::Arena,
  ) -> <<Self::Root as oxvg_ast::node::Node<'arena>>::Child as oxvg_ast::node::Node<'arena>>::ParentChild{
    arena.alloc(Node::new(
      NodeData::ProcessingInstruction {
        target,
        contents: RefCell::new(data),
      },
      0,
    ))
  }

  fn create_text_node(
    &self,
    data: <Self::Root as oxvg_ast::node::Node<'arena>>::Atom,
    arena: <Self::Root as oxvg_ast::node::Node<'arena>>::Arena,
  ) -> <Self::Root as oxvg_ast::node::Node<'arena>>::Child {
    arena.alloc(Node::new(
      NodeData::Text {
        contents: RefCell::new(data),
      },
      0,
    ))
  }
}

struct ChildNodes<'arena> {
  front: Option<Ref<'arena>>,
  end: Option<Ref<'arena>>,
}

impl<'arena> Iterator for ChildNodes<'arena> {
  type Item = Ref<'arena>;

  fn next(&mut self) -> Option<Self::Item> {
    if let Some(current) = self.front {
      self.front = current.next_sibling();
      return Some(current);
    }

    None
  }
}

impl DoubleEndedIterator for ChildNodes<'_> {
  fn next_back(&mut self) -> Option<Self::Item> {
    if let Some(current) = self.end {
      self.end = current.previous_sibling();
      return Some(current);
    }

    None
  }
}

impl ExactSizeIterator for ChildNodes<'_> {
  fn len(&self) -> usize {
    let mut current = self.front;
    let mut len = 0;
    while let Some(node) = current {
      current = node.next_sibling();
      len += 1;
    }
    len
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
  #[serde(
    default,
    deserialize_with = "ok_or_default",
    rename = "addClassesToSVGElement"
  )]
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
  #[serde(default, deserialize_with = "ok_or_default", rename = "cleanupAttrs")]
  pub cleanup_attributes: ConfigItem<oxvg_optimiser::CleanupAttributes>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub merge_styles: ConfigItem<()>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub inline_styles: ConfigItem<oxvg_optimiser::InlineStyles>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub minify_styles: ConfigItem<oxvg_optimiser::MinifyStyles>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub cleanup_ids: ConfigItem<oxvg_optimiser::CleanupIds>,
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
  pub remove_hidden_elems: ConfigItem<oxvg_optimiser::RemoveHiddenElems>,
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
  #[serde(
    default,
    deserialize_with = "ok_or_default",
    rename = "removeEditorsNSData"
  )]
  pub remove_editors_ns_data: ConfigItem<oxvg_optimiser::RemoveEditorsNSData>,
  #[serde(default, deserialize_with = "ok_or_default", rename = "removeUnusedNS")]
  pub remove_unused_n_s: ConfigItem<oxvg_optimiser::RemoveUnusedNS>,
  #[serde(default, deserialize_with = "ok_or_default", rename = "removeXMLNS")]
  pub remove_x_m_l_n_s: ConfigItem<oxvg_optimiser::RemoveXMLNS>,
  #[serde(default, deserialize_with = "ok_or_default")]
  pub remove_xlink: ConfigItem<oxvg_optimiser::RemoveXlink>,
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
  pub fn into_jobs(&self, kind: OxvgKind) -> oxvg_optimiser::Jobs {
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
      oxvg_optimiser::Jobs::none()
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
          .unwrap_or_else(|| oxvg_optimiser::PrefixIds::default().delim),
        prefix: match &c.prefix {
          None => Default::default(),
          Some(c) => oxvg_optimiser::PrefixGenerator::Prefix(c.clone()),
        },
        prefix_ids: c
          .prefix_ids
          .unwrap_or_else(|| oxvg_optimiser::PrefixIds::default().prefix_ids),
        prefix_class_names: c
          .prefix_class_names
          .unwrap_or_else(|| oxvg_optimiser::PrefixIds::default().prefix_class_names),
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
    job!(remove_editors_ns_data);
    job!(remove_unused_n_s);
    job!(remove_x_m_l_n_s);
    job!(remove_xlink);

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
      || self.remove_desc.is_some()
      || self.remove_editors_ns_data.is_some()
      || self.remove_unused_n_s.is_some()
      || self.remove_x_m_l_n_s.is_some()
      || self.remove_xlink.is_some();
  }
}
