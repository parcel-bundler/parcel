use swc_core::{
  common::{
    errors::{ColorConfig, Handler},
    sync::Lrc,
    FileName, SourceMap,
  },
  ecma::parser::{lexer::Lexer, Parser, StringInput, Syntax},
};

pub fn inline_requires(
  bundle_source: &String,
  asset_public_ids_with_side_effects: &Vec<String>,
) -> Option<String> {
  let cm: Lrc<SourceMap> = Default::default();
  let handler = Handler::with_tty_emitter(ColorConfig::Auto, true, false, Some(cm.clone()));
  let source = cm.new_source_file(FileName::Custom("test.js".into()), bundle_source.clone());

  let lexer = Lexer::new(
    Syntax::Es(Default::default()),
    Default::default(),
    StringInput::from(&*source),
    None,
  );

  let mut parser = Parser::new_from(lexer);
  let module = parser
    .parse_module()
    .map_err(|mut err| err.into_diagnostic(&handler).emit());

  Some("dang".into())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn assert_code(actual: String, expected: String) {
    let actual_lines = actual
      .split("\n")
      .map(|line| line.trim())
      .collect::<Vec<_>>()
      .join("\n");
    let expected_lines = expected
      .split("\n")
      .map(|line| line.trim())
      .collect::<Vec<_>>()
      .join("\n");
    assert_eq!(actual_lines, expected_lines);
  }

  #[test]
  fn performs_basic_inlining() {
    let src = r#"var $abc123 = require('abc123');
            console.log($abc123);`);
        "#
    .into();
    let result = inline_requires(src, vec![]);
    let expected: String = r#"var $abc123;
            console.log((0, require('abc123')));
        "#
    .into();
    assert_code(result.unwrap(), expected);
  }
}
