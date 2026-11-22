use rustc_hash::FxHashMap;
use swc_core::{
  common::{Mark, SyntaxContext},
  ecma::{
    ast::{self, Id},
    utils::IdentRenamer,
    visit::{VisitMut, VisitMutWith},
  },
};

use crate::transformer::utils::is_unresolved;

/// What a module's references to the Node `__filename` global are renamed to.
pub const FILENAME: &str = "$parcel$__filename";
/// What a module's references to the Node `__dirname` global are renamed to.
pub const DIRNAME: &str = "$parcel$__dirname";

/// Tracks whether a module references the Node.js `__filename` or `__dirname` globals, and
/// renames those references to [`FILENAME`] and [`DIRNAME`]. The packager declares them with
/// paths relative to the bundle. They are renamed rather than declared as `__filename` and
/// `__dirname` so that the module's declarations never shadow the bundle's own, which the
/// packager reads to find the bundle's directory, wherever they end up in the same scope.
pub struct NodeReplacer<'a> {
  pub unresolved_mark: Mark,
  pub needs_filename: &'a mut bool,
  pub needs_dirname: &'a mut bool,
  pub has_node_replacements: &'a mut bool,
}

impl<'a> VisitMut for NodeReplacer<'a> {
  fn visit_mut_module(&mut self, node: &mut ast::Module) {
    node.visit_mut_children_with(self);
    if !*self.needs_filename && !*self.needs_dirname {
      return;
    }

    let ctxt = SyntaxContext::empty().apply_mark(self.unresolved_mark);
    let mut renames = FxHashMap::<Id, Id>::default();
    if *self.needs_filename {
      renames.insert(("__filename".into(), ctxt), (FILENAME.into(), ctxt));
    }
    if *self.needs_dirname {
      renames.insert(("__dirname".into(), ctxt), (DIRNAME.into(), ctxt));
    }
    node.visit_mut_with(&mut IdentRenamer::new(&renames));
  }

  // Every reference is an `Ident`, which property names (`a.__dirname`, `{__dirname: 1}`) are
  // not, so this finds exactly the identifiers `IdentRenamer` renames.
  fn visit_mut_ident(&mut self, id: &mut ast::Ident) {
    // Only handle global variables
    if !is_unresolved(id, self.unresolved_mark) {
      return;
    }

    match id.sym.as_ref() {
      "__filename" => {
        *self.needs_filename = true;
        *self.has_node_replacements = true;
      }
      "__dirname" => {
        *self.needs_dirname = true;
        *self.has_node_replacements = true;
      }
      _ => {}
    }
  }
}

#[cfg(test)]
mod test {
  use crate::transformer::test_utils::run_visit;

  use super::*;

  fn run(code: &str) -> (String, bool, bool, bool) {
    let mut needs_filename = false;
    let mut needs_dirname = false;
    let mut has_node_replacements = false;
    let output = run_visit(code, |context| NodeReplacer {
      unresolved_mark: context.unresolved_mark,
      needs_filename: &mut needs_filename,
      needs_dirname: &mut needs_dirname,
      has_node_replacements: &mut has_node_replacements,
    })
    .output_code;
    (output, needs_filename, needs_dirname, has_node_replacements)
  }

  #[test]
  fn tracks_and_renames_filename() {
    let code = "const filename = __filename;\nconsole.log(__filename);";
    let (output, needs_filename, needs_dirname, has_node_replacements) = run(code);

    assert_eq!(
      output,
      "const filename = $parcel$__filename;\nconsole.log($parcel$__filename);\n"
    );
    assert!(needs_filename);
    assert!(!needs_dirname);
    assert!(has_node_replacements);
  }

  #[test]
  fn tracks_and_renames_dirname() {
    let code = "const dirname = __dirname;\nconsole.log(__dirname);";
    let (output, needs_filename, needs_dirname, has_node_replacements) = run(code);

    assert_eq!(
      output,
      "const dirname = $parcel$__dirname;\nconsole.log($parcel$__dirname);\n"
    );
    assert!(!needs_filename);
    assert!(needs_dirname);
    assert!(has_node_replacements);
  }

  #[test]
  fn ignores_shadowed_and_property_identifiers() {
    let code = r#"function something(__filename, __dirname) {
    console.log(__filename, __dirname);
}
console.log(object.__filename, object.__dirname);"#;
    let (output, needs_filename, needs_dirname, has_node_replacements) = run(code);

    assert_eq!(output, format!("{}\n", code));
    assert!(!needs_filename);
    assert!(!needs_dirname);
    assert!(!has_node_replacements);
  }

  #[test]
  fn tracks_computed_property_identifiers() {
    let code = "console.log(object[__filename], object[__dirname]);";
    let (output, needs_filename, needs_dirname, has_node_replacements) = run(code);

    assert_eq!(
      output,
      "console.log(object[$parcel$__filename], object[$parcel$__dirname]);\n"
    );
    assert!(needs_filename);
    assert!(needs_dirname);
    assert!(has_node_replacements);
  }

  #[test]
  fn keeps_shorthand_property_keys() {
    let code = "console.log({ __dirname });";
    let (output, needs_filename, needs_dirname, has_node_replacements) = run(code);

    assert_eq!(
      output,
      "console.log({\n    __dirname: $parcel$__dirname\n});\n"
    );
    assert!(!needs_filename);
    assert!(needs_dirname);
    assert!(has_node_replacements);
  }

  #[test]
  fn leaves_shadowed_identifiers_when_the_global_is_also_used() {
    let code = r#"function something(__dirname) {
    return __dirname;
}
console.log(__dirname, object.__dirname);"#;
    let (output, _, needs_dirname, _) = run(code);

    assert_eq!(
      output,
      r#"function something(__dirname) {
    return __dirname;
}
console.log($parcel$__dirname, object.__dirname);
"#
    );
    assert!(needs_dirname);
  }
}
