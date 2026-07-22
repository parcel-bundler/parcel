use swc_core::{
  common::Mark,
  ecma::{
    ast::{self, MemberProp},
    visit::{VisitMut, VisitMutWith},
  },
};

use crate::utils::is_unresolved;

/// Tracks whether a module references the Node.js `__filename` or `__dirname` globals.
/// The packager uses this information to insert module-local definitions with paths relative
/// to the bundle.
pub struct NodeReplacer<'a> {
  pub unresolved_mark: Mark,
  pub needs_filename: &'a mut bool,
  pub needs_dirname: &'a mut bool,
  pub has_node_replacements: &'a mut bool,
}

impl<'a> VisitMut for NodeReplacer<'a> {
  fn visit_mut_expr(&mut self, node: &mut ast::Expr) {
    use ast::Expr::*;

    match node {
      Ident(id) => {
        // Only handle global variables
        if !is_unresolved(&id, self.unresolved_mark) {
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
      _ => {
        node.visit_mut_children_with(self);
      }
    };
  }

  // Do not traverse into the `prop` side of member expressions unless computed.
  fn visit_mut_member_prop(&mut self, node: &mut MemberProp) {
    match node {
      MemberProp::Computed(computed) => {
        computed.visit_mut_children_with(self);
      }
      _ => {}
    }
  }
}

#[cfg(test)]
mod test {
  use crate::test_utils::run_visit;

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
  fn tracks_filename_without_transforming_it() {
    let code = "const filename = __filename;\nconsole.log(__filename);";
    let (output, needs_filename, needs_dirname, has_node_replacements) = run(code);

    assert_eq!(output, format!("{}\n", code));
    assert!(needs_filename);
    assert!(!needs_dirname);
    assert!(has_node_replacements);
  }

  #[test]
  fn tracks_dirname_without_transforming_it() {
    let code = "const dirname = __dirname;\nconsole.log(__dirname);";
    let (output, needs_filename, needs_dirname, has_node_replacements) = run(code);

    assert_eq!(output, format!("{}\n", code));
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

    assert_eq!(output, format!("{}\n", code));
    assert!(needs_filename);
    assert!(needs_dirname);
    assert!(has_node_replacements);
  }
}
