use std::{
  cell::RefCell,
  rc::Rc,
  sync::{PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard},
};

use rustc_hash::FxHashMap;
use swc_core::{
  atoms::atom,
  common::{
    BytePos, DUMMY_SP,
    comments::{Comment, CommentKind, Comments, SingleThreadedComments},
  },
};

type CommentMap = FxHashMap<BytePos, Vec<Comment>>;

/// A module's comments, from parsing it until packaging it. Behaves like swc's
/// `SingleThreadedComments`, but can be kept in an `Ast` that is packaged on another thread. Unlike
/// `SwcComments`, the maps aren't sharded: a module is transformed on one thread, and packaged by
/// one at a time, so locks are uncontended, and a store without comments allocates nothing.
#[derive(Default, Debug)]
pub struct ModuleComments {
  leading: RwLock<CommentMap>,
  trailing: RwLock<CommentMap>,
}

/// Nothing a panic could interrupt leaves a map inconsistent.
fn read(map: &RwLock<CommentMap>) -> RwLockReadGuard<'_, CommentMap> {
  map.read().unwrap_or_else(PoisonError::into_inner)
}

fn write(map: &RwLock<CommentMap>) -> RwLockWriteGuard<'_, CommentMap> {
  map.write().unwrap_or_else(PoisonError::into_inner)
}

impl Clone for ModuleComments {
  /// Copies the comments: a copy of an AST is transformed independently, e.g. minified.
  fn clone(&self) -> Self {
    ModuleComments {
      leading: RwLock::new(read(&self.leading).clone()),
      trailing: RwLock::new(read(&self.trailing).clone()),
    }
  }
}

impl ModuleComments {
  /// Removes the comments that `keep` returns false for.
  pub fn retain(&self, mut keep: impl FnMut(&Comment) -> bool) {
    for map in [&self.leading, &self.trailing] {
      write(map).retain(|_, comments| {
        comments.retain(&mut keep);
        !comments.is_empty()
      });
    }
  }

  /// A copy of the comments, for code that requires swc's single-threaded store.
  pub fn to_single_threaded(&self) -> SingleThreadedComments {
    SingleThreadedComments::from_leading_and_trailing(
      Rc::new(RefCell::new(read(&self.leading).clone())),
      Rc::new(RefCell::new(read(&self.trailing).clone())),
    )
  }
}

/// Like `SingleThreadedComments`' implementation.
impl Comments for ModuleComments {
  fn add_leading(&self, pos: BytePos, cmt: Comment) {
    write(&self.leading).entry(pos).or_default().push(cmt);
  }

  fn add_leading_comments(&self, pos: BytePos, comments: Vec<Comment>) {
    write(&self.leading)
      .entry(pos)
      .or_default()
      .extend(comments);
  }

  fn has_leading(&self, pos: BytePos) -> bool {
    read(&self.leading)
      .get(&pos)
      .is_some_and(|comments| !comments.is_empty())
  }

  fn move_leading(&self, from: BytePos, to: BytePos) {
    if let Some(mut comments) = self.take_leading(from) {
      if from < to && self.has_leading(to) {
        comments.extend(self.take_leading(to).unwrap());
      }
      self.add_leading_comments(to, comments);
    }
  }

  fn take_leading(&self, pos: BytePos) -> Option<Vec<Comment>> {
    write(&self.leading).remove(&pos)
  }

  fn get_leading(&self, pos: BytePos) -> Option<Vec<Comment>> {
    read(&self.leading).get(&pos).cloned()
  }

  fn add_trailing(&self, pos: BytePos, cmt: Comment) {
    write(&self.trailing).entry(pos).or_default().push(cmt);
  }

  fn add_trailing_comments(&self, pos: BytePos, comments: Vec<Comment>) {
    write(&self.trailing)
      .entry(pos)
      .or_default()
      .extend(comments);
  }

  fn has_trailing(&self, pos: BytePos) -> bool {
    read(&self.trailing)
      .get(&pos)
      .is_some_and(|comments| !comments.is_empty())
  }

  fn move_trailing(&self, from: BytePos, to: BytePos) {
    if let Some(mut comments) = self.take_trailing(from) {
      if from < to && self.has_trailing(to) {
        comments.extend(self.take_trailing(to).unwrap());
      }
      self.add_trailing_comments(to, comments);
    }
  }

  fn take_trailing(&self, pos: BytePos) -> Option<Vec<Comment>> {
    write(&self.trailing).remove(&pos)
  }

  fn get_trailing(&self, pos: BytePos) -> Option<Vec<Comment>> {
    read(&self.trailing).get(&pos).cloned()
  }

  fn add_pure_comment(&self, pos: BytePos) {
    assert_ne!(pos, BytePos(0), "cannot add pure comment to zero position");
    let mut leading = write(&self.leading);
    let comments = leading.entry(pos).or_default();
    if !comments.iter().any(|c| &*c.text == "#__PURE__") {
      comments.push(Comment {
        kind: CommentKind::Block,
        span: DUMMY_SP,
        text: atom!("#__PURE__"),
      });
    }
  }

  fn with_leading<F, Ret>(&self, pos: BytePos, f: F) -> Ret
  where
    F: FnOnce(&[Comment]) -> Ret,
  {
    f(read(&self.leading).get(&pos).map_or(&[], Vec::as_slice))
  }

  fn with_trailing<F, Ret>(&self, pos: BytePos, f: F) -> Ret
  where
    F: FnOnce(&[Comment]) -> Ret,
  {
    f(read(&self.trailing).get(&pos).map_or(&[], Vec::as_slice))
  }

  /// Whether a leading block comment at `lo` is the annotation `flag`, e.g. `#__PURE__`.
  fn has_flag(&self, lo: BytePos, flag: &str) -> bool {
    self.with_leading(lo, |comments| {
      comments
        .iter()
        .filter(|c| c.kind == CommentKind::Block)
        .flat_map(|c| c.text.lines())
        .any(|line| {
          // Also in JSDoc comments.
          let line = line.trim_start_matches(['*', ' ']).trim();
          line.len() == flag.len() + 5
            && (line.starts_with("#__") || line.starts_with("@__"))
            && line.ends_with("__")
            && flag == &line[3..line.len() - 2]
        })
    })
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn comment(text: &str) -> Comment {
    Comment {
      kind: CommentKind::Block,
      span: DUMMY_SP,
      text: text.into(),
    }
  }

  #[test]
  fn moves_comments_like_single_threaded_comments() {
    let comments = ModuleComments::default();
    comments.add_leading(BytePos(1), comment("a"));
    comments.add_leading(BytePos(2), comment("b"));
    // Moving forward puts the moved comments first.
    comments.move_leading(BytePos(1), BytePos(2));
    assert!(!comments.has_leading(BytePos(1)));
    let texts: Vec<_> = comments
      .get_leading(BytePos(2))
      .unwrap()
      .iter()
      .map(|c| c.text.to_string())
      .collect();
    assert_eq!(texts, ["a", "b"]);
  }

  #[test]
  fn finds_pure_annotations() {
    let comments = ModuleComments::default();
    comments.add_leading(BytePos(1), comment("@__PURE__"));
    comments.add_leading(BytePos(2), comment("*\n * #__NO_SIDE_EFFECTS__\n "));
    assert!(comments.has_flag(BytePos(1), "PURE"));
    assert!(comments.has_flag(BytePos(2), "NO_SIDE_EFFECTS"));
    assert!(!comments.has_flag(BytePos(1), "NO_SIDE_EFFECTS"));

    comments.add_pure_comment(BytePos(3));
    comments.add_pure_comment(BytePos(3));
    assert_eq!(comments.get_leading(BytePos(3)).unwrap().len(), 1);
  }

  #[test]
  fn copies_are_independent() {
    let comments = ModuleComments::default();
    comments.add_trailing(BytePos(1), comment("a"));
    let copy = comments.clone();
    copy.take_trailing(BytePos(1));
    assert!(comments.has_trailing(BytePos(1)));
  }
}
