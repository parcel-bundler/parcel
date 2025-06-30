mod buffer;
mod collect_constants;
mod evaluate;
mod fs;
mod function;
mod import;
mod js_value;
mod macros;
mod module;
mod object;
mod path;
mod process;
mod promise;
mod require;
mod url;
mod worker;

pub use evaluate::{Evaluate, Evaluator};
pub use function::*;
pub use js_value::*;
pub use object::*;

#[cfg(test)]
mod test {
  use super::*;
  use pretty_assertions::assert_eq;
  use swc_core::common::{sync::Lrc, FileName, SourceMap};
  use swc_core::ecma::parser::parse_file_as_expr;

  fn test(code: &str, expected: &str) {
    let source_map = Lrc::new(SourceMap::default());
    let source_file = source_map.new_source_file(Lrc::new(FileName::Anon), code.into());
    let expr = parse_file_as_expr(
      &source_file,
      Default::default(),
      Default::default(),
      None,
      &mut Vec::new(),
    )
    .unwrap();

    let mut evaluator = Evaluator::new();
    // collect_constants(&expr, &mut evaluator);
    let result = expr.evaluate(&evaluator);
    assert_eq!(&format!("{}", result), expected);
  }

  #[test]
  fn test_eval_bin_expr() {
    test("2", "2");
    test("2 + 2", "4");
    test("4 - 2", "2");
    test("2 * 3", "6");
    test("4 / 2", "2");
    test("2.5 / 2", "1.25");
    test("2 ** 4", "16");
    test("1 << 4", "16");
    test("4 >> 1", "2");
    test("4.2 >> 1", "2");
    test("4 >>> 1", "2");
    test("3 & 1", "1");
    test("1 | 2", "3");
    test("1 ^ 2", "3");
    test("3 || 1", "3");
    test("0 || 2", "2");
    test("2 == 2", "true");
    test("2 == 4", "false");
    test("'2' == 2", "unknown");
    test("2 === 2", "true");
    test("2 === 4", "false");
    // test("'2' === 2", "false");
    test("4 > 2", "true");
    test("2 > 4", "false");
    test("2 > 2", "false");
    test("4 < 2", "false");
    test("2 < 4", "true");
    test("2 < 2", "false");
    test("4 >= 2", "true");
    test("2 >= 4", "false");
    test("2 >= 2", "true");
    test("4 <= 2", "false");
    test("2 <= 4", "true");
    test("2 <= 2", "true");

    test("2n", "2n");
    test("2n + 2n", "4n");
    test("4n - 2n", "2n");
    test("2n * 3n", "6n");
    test("4n / 2n", "2n");
    test("2n ** 4n", "16n");
    test("1n << 4n", "16n");
    test("4n >> 1n", "2n");
    test("3n & 1n", "1n");
    test("1n | 2n", "3n");
    test("1n ^ 2n", "3n");
    test("3n || 1n", "3n");
    test("0n || 2n", "2n");
    test("2n == 2n", "true");
    test("2n == 4n", "false");
    test("'2' == 2n", "unknown");
    test("2n === 2n", "true");
    test("2n === 4n", "false");
    // test("'2' === 2n", "false");
    test("4n > 2n", "true");
    test("2n > 4n", "false");
    test("2n > 2n", "false");
    test("4n < 2n", "false");
    test("2n < 4n", "true");
    test("2n < 2n", "false");
    test("4n >= 2n", "true");
    test("2n >= 4n", "false");
    test("2n >= 2n", "true");
    test("4n <= 2n", "false");
    test("2n <= 4n", "true");
    test("2n <= 2n", "true");

    test("false || 'test'", "\"test\"");
    test("'test' || 'foo'", "\"test\"");
    test("'' || 'foo'", "\"foo\"");
    test("false && 'test'", "false");
    test("'test' && 'foo'", "\"foo\"");
    test("'' && 'foo'", "\"\"");

    test("'foo' + 'bar'", "\"foobar\"");
    test("'foo' + 2", "\"foo2\"");
    test("2 + 'bar'", "\"2bar\"");
    test("2 - '4'", "unknown");

    test("void 0 ?? 4", "4");
    test("null ?? 4", "4");
    test("false ?? 4", "false");
    test("8 ?? 4", "8");

    test("('foo' in {foo: 2})", "true");
    test("('foo' in {bar: 2})", "false");
  }

  #[test]
  fn test_unary() {
    test("!true", "false");
    test("!false", "true");
    test("!!true", "true");
    test("!0", "true");
    test("!1", "false");
    test("!''", "true");
    test("!'hi'", "false");
    test("!null", "true");
    test("-(4 + 3)", "-7");
    test("-(4n + 3n)", "-7n");
    test("+(4 - 8)", "-4");
    test("+'123'", "123");
    test("+'-123'", "-123");
    test("+'-123.582'", "-123.582");
    test("~4", "-5");
    test("~4.4", "-5");
    test("~4n", "-5n");
    test("void 0", "undefined");
    test("typeof 0", "\"number\"");
    test("typeof 0n", "\"bigint\"");
    test("typeof true", "\"boolean\"");
    test("typeof 'test'", "\"string\"");
    test("typeof {}", "\"object\"");
    test("typeof null", "\"object\"");
    // test("typeof (() => {})", "\"function\"");
  }

  #[test]
  fn test_cond() {
    test("true ? 3 : 4", "3");
    test("false ? 3 : 4", "4");
    test("0 ? 3 : 4", "4");
    test("1 ? 3 : 4", "3");
  }

  #[test]
  fn test_seq() {
    test("2 + 2, 3 + 4, 'hi'", "\"hi\"");
  }

  #[test]
  fn test_tpl() {
    test("`foo`", "\"foo\"");
    test("`foo_${'bar'}`", "\"foo_bar\"");
    test("`foo_${2}`", "\"foo_2\"");
    test("`foo_${true}`", "\"foo_true\"");
  }

  #[test]
  fn test_object() {
    test("{foo: 2}", "{foo: 2}");
    // test(
    //   "{get foo() {return 2}}",
    //   "{get foo() { side_effects = No; return 2 }}",
    // );
    // test("{set foo() {}}", "{set foo() { side_effects = No }}");
    // test(
    //   "{foo() { return 2 }}",
    //   "{foo: function() { side_effects = No; return 2 }}",
    // );
    test("{foo: 2, ...{bar: 3}}", "{foo: 2, bar: 3}");
    test("{foo: 2, ...[1, 2]}", "unknown");
    test("{foo: 2, ...unknown}", "unknown");
  }

  #[test]
  fn test_array() {
    test("[2, 3]", "[2, 3]");
    test("[2, ...[3, 4]]", "[2, 3, 4]");
    test("[2, ...unknown]", "unknown");
    test("[2, ...({foo: 2})]", "unknown");
  }

  #[test]
  fn test_member() {
    test("{foo: 2}.foo", "2");
    test("{foo: {bar: {baz: 2}}}.foo.bar.baz", "2");
    test("[2, 3, 4][2]", "4");
    test("[2, 3, 4].length", "3");
    test("'hello'.length", "5");
    test("{foo: 2}?.foo", "2");
    test("null?.foo", "undefined");
    // test("{get foo() {return 2}}.foo", "2");
  }

  #[test]
  fn test_function() {
    test("(function() { return 2 })()", "2");
    test("(function() { return })()", "undefined");
    test("(function() { return {foo: 2} })().foo", "2");
    test("(function(i) { return i + 2 })(4)", "6");
    test("(function({i}) { return i + 2 })({i: 4})", "6");
    test("(() => {return 2})()", "2");
    test("(() => {return})()", "undefined");
    test("(() => 2)()", "2");
    test("((i) => i + 2)(4)", "6");
    test("(({i}) => i + 2)({i: 4})", "6");
    test("{foo() { return 4 }}.foo()", "4");
    test("{foo() { return 4 }}?.foo()", "4");
  }
}
