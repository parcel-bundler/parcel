mod builtins;
mod collect_constants;
mod dependencies;
mod evaluate;
mod js_value;
mod link;
mod module;
mod transform;

pub use builtins::array::*;
pub use builtins::function::*;
pub use builtins::object::*;
pub use evaluate::{Evaluate, Evaluator};
pub use js_value::*;

#[cfg(test)]
mod test {
  use super::*;
  use pretty_assertions::assert_eq;
  use swc_core::common::SyntaxContext;
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

    let evaluator = Evaluator::new_global(SyntaxContext::empty());
    let result = expr.evaluate(&evaluator);
    assert_eq!(&format!("{}", result), expected);
  }

  #[test]
  fn test_eval_bin_expr() {
    test("2", "2");
    test("2 + 2", "4");
    test("2 + '2'", "\"22\"");
    test("4 - 2", "2");
    test("2 * 3", "6");
    test("4 / 2", "2");
    test("2.5 / 2", "1.25");
    test("2 ** 4", "16");
    test("1 << 4", "16");
    test("-0xffffffff << 10", "1024");
    test("4 >> 1", "2");
    test("-9 >> 2", "-3");
    test("4.2 >> 1", "2");
    test("0xffffffff >> 10", "-1");
    test("4 >>> 1", "2");
    test("-9 >>> 2", "1073741821");
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
    test("2 - '4'", "-2");

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
    test("{foo: 2, ...[1, 2]}", "{foo: 2, 0: 1, 1: 2}");
    test("{foo: 2, ...unknown}", "unknown");
    test("'' + {foo: 2}", "\"[object Object]\"");
  }

  #[test]
  fn test_array() {
    test("[2, 3]", "[2, 3]");
    test("[2, ...[3, 4]]", "[2, 3, 4]");
    test("[2, ...unknown]", "unknown");
    test("[2, ...({foo: 2})]", "unknown");
    test("[2, 3].length", "2");
    test("'' + [2, 3]", "\"2,3\"");
    test("[2, 3, 4][1]", "3");
    test("[2, 3, 4][-1]", "undefined");

    test("[2, 3, 4].at(1)", "3");
    test("[2, 3, 4].at(-1)", "4");
    test("[2, 3, 4].at(100)", "undefined");

    test("[2, 3, 4].every(v => v > 0)", "true");
    test("[2, -3, 4].every(v => v > 0)", "false");
    test("[2, 3, 4].every(v => alert('hi'))", "unknown");
    test("[2, 3, 4].every(v => (this + v) >= 4, 2)", "true");
    test("[2, 3, 4].every(v => (this + v) >= 4, 1)", "false");
    test("[2, 3, 4].every((v, i) => (v * i) > 3)", "false");
    test(
      "[2, 3, 4].every((v, i, a) => v + (a[i - 1] || 0) > 3)",
      "false",
    );
    test("[1, , 3].every((x) => x !== undefined)", "true");

    test("[2, 3, 4].some(v => v > 0)", "true");
    test("[2, 3, 4].some(v => v < 0)", "false");
    test("[2, -3, 4].some(v => v > 0)", "true");
    test("[2, 3, 4].some(v => alert('hi'))", "unknown");
    test("[2, 3, 4].some(v => (this + v) >= 4, 2)", "true");
    test("[2, 3, 4].some(v => (this + v) >= 4, 1)", "true");
    test("[2, 3, 4].some((v, i) => (v * i) > 3)", "true");
    test(
      "[2, 3, 4].some((v, i, a) => v + (a[i - 1] || 0) > 3)",
      "true",
    );
    test("[1, , 3].some((x) => x === undefined)", "false");
    test("[1, undefined, 3].some((x) => x === undefined)", "true");

    test("[2, 3, 4].filter(v => v > 0)", "[2, 3, 4]");
    test("[2, 3, 4].filter(v => v < 0)", "[]");
    test("[2, -3, 4].filter(v => v > 0)", "[2, 4]");
    test("[2, 3, 4].filter(v => alert('hi'))", "unknown");
    test("[2, 3, 4].filter(v => (this + v) >= 4, 2)", "[2, 3, 4]");
    test("[2, 3, 4].filter(v => (this + v) >= 4, 1)", "[3, 4]");
    test("[2, 3, 4].filter((v, i) => (v * i) > 3)", "[4]");
    test(
      "[2, 3, 4].filter((v, i, a) => v + (a[i - 1] || 0) > 3)",
      "[3, 4]",
    );
    test(
      "[1, , undefined].filter((x) => x === undefined)",
      "[undefined]",
    );

    test("[2, 3, 4].find(v => v > 0)", "2");
    test("[2, 3, 4].find(v => v < 0)", "undefined");
    test("[-2, 3, 4].find(v => v > 0)", "3");
    test("[2, 3, 4].find(v => alert('hi'))", "unknown");
    test("[2, 3, 4].find(v => (this + v) >= 4, 2)", "2");
    test("[2, 3, 4].find(v => (this + v) >= 4, 1)", "3");
    test("[2, 3, 4].find((v, i) => (v * i) > 3)", "4");
    test("[2, 3, 4].find((v, i, a) => v + (a[i - 1] || 0) > 3)", "3");
    test(
      "[0, 1, , , , 5, 6].find((v, i, a) => i > 0 && v !== undefined && a[i - 1] === undefined)",
      "5",
    );

    test("[2, 3, 4].findLast(v => v > 0)", "4");
    test("[2, 3, 4].findLast(v => v < 0)", "undefined");
    test("[2, 3, -4].findLast(v => v > 0)", "3");
    test("[2, 3, 4].findLast(v => alert('hi'))", "unknown");
    test("[2, 3, 4].findLast(v => (this + v) >= 4, 2)", "4");
    test("[2, 3, 4].findLast(v => (this + v) >= 4, 1)", "4");
    test("[2, 3, 4].findLast((v, i) => (v * i) > 3)", "4");
    test(
      "[2, 3, 4].findLast((v, i, a) => v + (a[i - 1] || 0) > 3)",
      "4",
    );
    test(
      "[0, 1, , , , 5].findLast((v, i, a) => i < a.length - 1 && v !== undefined && a[i + 1] === undefined)",
      "1",
    );

    test("[2, 3, 4].findIndex(v => v > 0)", "0");
    test("[2, 3, 4].findIndex(v => v < 0)", "undefined");
    test("[-2, 3, 4].findIndex(v => v > 0)", "1");
    test("[2, 3, 4].findIndex(v => alert('hi'))", "unknown");
    test("[2, 3, 4].findIndex(v => (this + v) >= 4, 2)", "0");
    test("[2, 3, 4].findIndex(v => (this + v) >= 4, 1)", "1");
    test("[2, 3, 4].findIndex((v, i) => (v * i) > 3)", "2");
    test(
      "[2, 3, 4].findIndex((v, i, a) => v + (a[i - 1] || 0) > 3)",
      "1",
    );
    test(
      "[0, 1, , , , 5, 6].findIndex((v, i, a) => i > 0 && v !== undefined && a[i - 1] === undefined)",
      "5",
    );

    test("[2, 3, 4].findLastIndex(v => v > 0)", "2");
    test("[2, 3, 4].findLastIndex(v => v < 0)", "undefined");
    test("[2, 3, -4].findLastIndex(v => v > 0)", "1");
    test("[2, 3, 4].findLastIndex(v => alert('hi'))", "unknown");
    test("[2, 3, 4].findLastIndex(v => (this + v) >= 4, 2)", "2");
    test("[2, 3, 4].findLastIndex(v => (this + v) >= 4, 1)", "2");
    test("[2, 3, 4].findLastIndex((v, i) => (v * i) > 3)", "2");
    test(
      "[2, 3, 4].findLastIndex((v, i, a) => v + (a[i - 1] || 0) > 3)",
      "2",
    );
    test(
      "[0, 1, , , , 5].findLastIndex((v, i, a) => i < a.length - 1 && v !== undefined && a[i + 1] === undefined)",
      "1",
    );

    test("[2, 3, 4].includes(2)", "true");
    test("[2, 3, 4].includes(8)", "false");
    test("[2, 3, 4].includes('2')", "false");
    test("[2, 3, NaN].includes(NaN)", "true");
    test("[2, 3, 4].includes(2, 1)", "false");
    test("[2, 3, 4].includes(2, 10)", "false");
    test("['a', 'b', 'c'].includes('a', -100)", "true");
    test("['a', 'b', 'c'].includes('a', -2)", "false");
    test("[1, , 3].includes(undefined)", "true");

    test("[2, 3, 4].indexOf(2)", "0");
    test("[2, 3, 4].indexOf(8)", "-1");
    test("[2, 3, 4].indexOf('2')", "-1");
    test("[2, 3, NaN].indexOf(NaN)", "-1");
    test("[2, 3, 4].indexOf(2, 1)", "-1");
    test("[2, 3, 4].indexOf(2, 10)", "-1");
    test("[2, 3, 2].indexOf(2, 1)", "2");
    test("['a', 'b', 'c'].indexOf('a', -100)", "0");
    test("['a', 'b', 'c'].indexOf('a', -2)", "-1");
    test("[1, , 3].indexOf(undefined)", "-1");

    test("[2, 3, 4].lastIndexOf(2)", "0");
    test("[2, 3, 4].lastIndexOf(8)", "-1");
    test("[2, 3, 4].lastIndexOf('2')", "-1");
    test("[2, 3, NaN].lastIndexOf(NaN)", "-1");
    test("[2, 3, 4].lastIndexOf(2, 1)", "0");
    test("[2, 3, 4].lastIndexOf(2, 10)", "0");
    test("[2, 3, 2].lastIndexOf(2, 1)", "0");
    test("['a', 'b', 'c'].lastIndexOf('a', -100)", "-1");
    test("['a', 'b', 'c'].lastIndexOf('c', -2)", "-1");
    test("[2, 5, 9, 2].lastIndexOf(2)", "3");
    test("[2, 5, 9, 2].lastIndexOf(7)", "-1");
    test("[2, 5, 9, 2].lastIndexOf(2, 3)", "3");
    test("[2, 5, 9, 2].lastIndexOf(2, 2)", "0");
    test("[2, 5, 9, 2].lastIndexOf(2, -2)", "0");
    test("[2, 5, 9, 2].lastIndexOf(2, -1)", "3");
    test("[1, , 3].lastIndexOf(undefined)", "-1");

    test("[1, 4, 9, 16].map(v => v * 2)", "[2, 8, 18, 32]");
    test("['1', '2', '3'].map(Number)", "[1, 2, 3]");
    test("[{a: 1}, {a: 2}, {a: 3}].map(v => v.a)", "[1, 2, 3]");
    test("[1, 4, 9, 16].map(v => v * this, 2)", "[2, 8, 18, 32]");
    test("[1, 4, 9, 16].map((v, i) => v * i)", "[0, 4, 18, 48]");
    test(
      "[1, 4, 9, 16].map((v, i, a) => v + (a[i - 1] || 0))",
      "[1, 5, 13, 25]",
    );
    test("[1, , 3].map(x => x * 2)", "[2, , 6]");

    test("[0, 1, 2, [3, 4]].flat()", "[0, 1, 2, 3, 4]");
    test("[0, 1, [2, [3, [4, 5]]]].flat()", "[0, 1, 2, [3, [4, 5]]]");
    test("[0, 1, [2, [3, [4, 5]]]].flat(2)", "[0, 1, 2, 3, [4, 5]]");
    test(
      "[0, 1, [2, [3, [4, 5]]]].flat(Infinity)",
      "[0, 1, 2, 3, 4, 5]",
    );
    test("[0, 1, [2, [3, [a, 5]]]].flat(2)", "unknown");
    test("[1, 2, , 4, 5].flat()", "[1, 2, 4, 5]");
    test("[1, , 3, ['a', , 'c']].flat()", "[1, 3, \"a\", \"c\"]");

    test(
      "[1, 2, 3, 4].flatMap(v => [v, v * 2])",
      "[1, 2, 2, 4, 3, 6, 4, 8]",
    );
    test(
      "[1, 2, 3, 4].flatMap(v => [[v, v * 2]])",
      "[[1, 2], [2, 4], [3, 6], [4, 8]]",
    );
    test(
      "[1, 2, 3, 4].flatMap(v => [v, v * this], 2)",
      "[1, 2, 2, 4, 3, 6, 4, 8]",
    );
    test(
      "[1, 2, 3, 4].flatMap((v, i) => [v, v * i])",
      "[1, 0, 2, 2, 3, 6, 4, 12]",
    );
    test(
      "[1, 2, 3, 4].flatMap((v, i, a) => [v, v + (a[i - 1] || 0)])",
      "[1, 1, 2, 3, 3, 5, 4, 7]",
    );
    test(
      "[1, 2, , 4, 5].flatMap((x) => [x, x * 2])",
      "[1, 2, 2, 4, 4, 8, 5, 10]",
    );
    test("[1, 2, 3, 4].flatMap((x) => [, x * 2])", "[2, 4, 6, 8]");

    test("[1, 2, 3].join()", "\"1,2,3\"");
    test("[1, 2, 3].join(' and ')", "\"1 and 2 and 3\"");
    test("[1, , 3].join()", "\"1,,3\"");
    test("[1, undefined, 3].join()", "\"1,,3\"");

    test("[1, 2, 3].toReversed()", "[3, 2, 1]");
    test("[1, , 3].toReversed()", "[3, undefined, 1]");

    test("[1, 2, 3, 4].slice()", "[1, 2, 3, 4]");
    test("[1, 2, 3, 4].slice(1)", "[2, 3, 4]");
    test("[1, 2, 3, 4].slice(1, 3)", "[2, 3]");
    test("[1, 2, 3, 4].slice(-2)", "[3, 4]");
    test("[1, 2, 3, 4].slice(-100)", "[1, 2, 3, 4]");
    test("[1, 2, 3, 4].slice(1, -1)", "[2, 3]");
    test("[1, 2, 3, 4].slice(0, 100)", "[1, 2, 3, 4]");
    test("[1, 2, 3, 4].slice(-100, -100)", "[]");
    test("[1, 2, 3, 4].slice(-100, 100)", "[1, 2, 3, 4]");
    test("[1, 2, , 4, 5].slice(1, 4)", "[2, , 4]");

    test("[1, 100].reduce((a, b) => Math.max(a, b), 50)", "100");
    test("[50].reduce((a, b) => Math.max(a, b), 10)", "50");
    test("[1, 100].reduce((a, b) => Math.max(a, b))", "100");
    test("[50].reduce((a, b) => Math.max(a, b))", "50");
    test("[].reduce((a, b) => Math.max(a, b), 1)", "1");
    test("[].reduce((a, b) => Math.max(a, b))", "unknown");
    test("[1, 2, , 4].reduce((a, b) => a + b)", "7");
    test("[1, 2, undefined, 4].reduce((a, b) => a + b)", "NaN");

    test("[0, 1, 2, 3].reduceRight((a, b) => a + b)", "6");
    test(
      "['1', '2', '3', '4'].reduceRight((a, b) => a + b)",
      "\"4321\"",
    );
    test(
      "['1', '2', '3', '4'].reduceRight((a, b) => a + b, '5')",
      "\"54321\"",
    );
    test("[50].reduceRight((a, b) => Math.max(a, b), 10)", "50");
    test("[].reduceRight((a, b) => Math.max(a, b), 1)", "1");
    test("[].reduceRight((a, b) => Math.max(a, b))", "unknown");
    test("[1, 2, , 4].reduceRight((a, b) => a + b)", "7");
    test("[1, 2, undefined, 4].reduceRight((a, b) => a + b)", "NaN");

    test("[1, 10, 21, 2].toSorted()", "[1, 10, 2, 21]");
    test("[1, 10, 21, 2].toSorted((a, b) => a - b)", "[1, 2, 10, 21]");
    test(
      "['a', 'c', , 'b'].toSorted()",
      "[\"a\", \"b\", \"c\", undefined]",
    );
    test(
      "[, undefined, 'a', 'b'].toSorted()",
      "[\"a\", \"b\", undefined, undefined]",
    );
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

  #[test]
  fn test_string() {
    test("'foo'", "\"foo\"");
    test("'foo'.length", "3");
    test("'😍'.length", "2");
    test("'foo'[1]", "\"o\"");
    test("'foo'[5]", "undefined");
    test("'😍'[0]", "unknown");
    test("'😍x'[2]", "\"x\"");
    test("'foo'.toUpperCase()", "\"FOO\"");
    test("'FOO'.toLowerCase()", "\"foo\"");
    test("' foo '.trim()", "\"foo\"");
    test("' foo '.trimStart()", "\"foo \"");
    test("' foo '.trimEnd()", "\" foo\"");
    test("'food'.includes('foo')", "true");
    test("'food'.includes('test')", "false");
    test("'food'.startsWith('foo')", "true");
    test("'food'.startsWith('test')", "false");
    test("'food'.endsWith('od')", "true");
    test("'food'.endsWith('test')", "false");
    test("'abc'.codePointAt(1)", "98");
    test("'abc'.codePointAt(-10)", "undefined");
    test("'abc'.codePointAt(10)", "undefined");
    test("'😍'.codePointAt(0)", "128525");
    test("'😍'.codePointAt(1)", "56845");
    test("'abc'.charCodeAt(1)", "98");
    test("'abc'.charCodeAt(-10)", "undefined");
    test("'abc'.charCodeAt(10)", "undefined");
    test("'𠮷𠮾'.charCodeAt(0)", "55362");
    test("'𠮷𠮾'.charCodeAt(1)", "57271");
    test("'abc'.charAt(1)", "\"b\"");
    test("'abc'.charAt(-10)", "\"\"");
    test("'abc'.charAt(10)", "\"\"");
    test("'😍'.charAt(0)", "unknown");
    test("'😍x'.charAt(2)", "\"x\"");
    test("'abc'.at(1)", "\"b\"");
    test("'abc'.at(-1)", "\"c\"");
    test("'abc'.at(-3)", "\"a\"");
    test("'abc'.at(-4)", "undefined");
    test("'abc'.at(4)", "undefined");
    test("'Mozilla'.slice(1, 3)", "\"oz\"");
    test("'Mozilla'.slice(2)", "\"zilla\"");
    test("'Mozilla'.slice(7, 4)", "\"\"");
    test("'Mozilla'.slice(-2)", "\"la\"");
    test("'Mozilla'.slice(2, -2)", "\"zil\"");
    test("'yay '.repeat(3)", "\"yay yay yay \"");
    test("'yay '.repeat(0)", "\"\"");
    test("'Hello'.concat(' ', 'world!')", "\"Hello world!\"");
    test("''.concat(...['Hello', ' ', 'world!'])", "\"Hello world!\"");
    test("'Hello world'.indexOf('')", "0");
    test("'Hello world'.indexOf('', 0)", "0");
    test("'Hello world'.indexOf('', 3)", "3");
    test("'Hello world'.indexOf('', 100)", "11");
    test("'Hello world'.indexOf('Hello')", "0");
    test("'Hello world'.indexOf('Hello', 1)", "-1");
    test("'Hello world'.indexOf('world')", "6");
    test("'Hello world'.indexOf('test')", "-1");
    test("'Hello world hello world'.indexOf('world', 6)", "6");
    test("'Hello world hello world'.indexOf('world', 7)", "18");
    test("[...'hi']", "[\"h\", \"i\"]");
    test("[...'👉🏿']", "[\"👉\", \"🏿\"]");
  }

  #[test]
  fn test_number() {
    test("parseFloat('2.34')", "2.34");
    test("parseFloat('  2.34')", "2.34");
    test("parseFloat('NaN')", "NaN");
    test("parseFloat('314e-2')", "3.14");
    test("parseFloat('0.0314E+2')", "3.14");
    test("parseFloat('1.7976931348623159e+308')", "Infinity");
    test("parseFloat('-1.7976931348623159e+308')", "-Infinity");
    test("parseFloat(900719925474099267n)", "900719925474099300");
    test("parseFloat(123)", "123");
    test("parseFloat('Infinity')", "Infinity");

    test("Number.parseFloat('2.34')", "2.34");
    test("Number.parseFloat('  2.34')", "2.34");
    test("Number.parseFloat('NaN')", "NaN");
    test("Number.parseFloat('314e-2')", "3.14");
    test("Number.parseFloat('0.0314E+2')", "3.14");
    test("Number.parseFloat('1.7976931348623159e+308')", "Infinity");
    test("Number.parseFloat('-1.7976931348623159e+308')", "-Infinity");
    test(
      "Number.parseFloat(900719925474099267n)",
      "900719925474099300",
    );
    test("Number.parseFloat(123)", "123");
    test("Number.parseFloat('Infinity')", "Infinity");

    test("parseInt('123')", "123");
    test("parseInt('123', 10)", "123");
    test("parseInt('  123  ')", "123");
    test("parseInt('077')", "77");
    test("parseInt('1.9')", "1");
    test("parseInt('ff', 16)", "255");
    test("parseInt('0xff')", "255");
    test("parseInt('0xF')", "15");
    test("parseInt('F', 16)", "15");
    test("parseInt('17', 8)", "15");
    test("parseInt('015', 10)", "15");
    test("parseInt('15,123', 10)", "15");
    test("parseInt('FXX123', 16)", "15");
    test("parseInt('1111', 2)", "15");
    test("parseInt('15 * 3', 10)", "15");
    test("parseInt('15e2', 10)", "15");
    test("parseInt('12', 13)", "15");
    test("parseInt('0e0', 16)", "224");
    test("parseInt(15.99)", "15");
    test("parseInt('Infinity')", "NaN");

    test("Number.parseInt('123')", "123");
    test("Number.parseInt('123', 10)", "123");
    test("Number.parseInt('  123  ')", "123");
    test("Number.parseInt('077')", "77");
    test("Number.parseInt('1.9')", "1");
    test("Number.parseInt('ff', 16)", "255");
    test("Number.parseInt('0xff')", "255");
    test("Number.parseInt('0xF')", "15");
    test("Number.parseInt('F', 16)", "15");
    test("Number.parseInt('17', 8)", "15");
    test("Number.parseInt('015', 10)", "15");
    test("Number.parseInt('15,123', 10)", "15");
    test("Number.parseInt('FXX123', 16)", "15");
    test("Number.parseInt('1111', 2)", "15");
    test("Number.parseInt('15 * 3', 10)", "15");
    test("Number.parseInt('15e2', 10)", "15");
    test("Number.parseInt('12', 13)", "15");
    test("Number.parseInt('0e0', 16)", "224");
    test("Number.parseInt(15.99)", "15");
    test("Number.parseInt('Infinity')", "NaN");

    test("Number('123')", "123");
    test("Number('2.34')", "2.34");
    test("Number('  2.34')", "2.34");
    test("Number('12a')", "unknown");
    test("Number('0xff')", "255");
    test("Number('0b11')", "3");
    test("Number('0o12')", "10");
    test("Number(true)", "1");
    test("Number(false)", "0");

    test("+(new Number('123'))", "123");

    test("isNaN(NaN)", "true");
    test("isNaN(undefined)", "true");
    test("isNaN({})", "true");
    test("isNaN(true)", "false");
    test("isNaN(null)", "false");
    test("isNaN(37)", "false");
    test("isNaN('37')", "false");
    test("isNaN('37.37')", "false");
    test("isNaN('37,5')", "true");
    test("isNaN('123abc')", "true");
    test("isNaN('')", "false");
    test("isNaN(' ')", "false");
    test("isNaN([])", "false");
    test("isNaN([1])", "false");
    test("isNaN([1, 2])", "true");

    test("Number.isNaN(NaN)", "true");
    test("Number.isNaN(Number.NaN)", "true");
    test("Number.isNaN(0 / 0)", "true");
    test("Number.isNaN(undefined)", "false");
    test("Number.isNaN({})", "false");
    test("Number.isNaN(true)", "false");
    test("Number.isNaN(null)", "false");
    test("Number.isNaN(37)", "false");
    test("Number.isNaN('37')", "false");
    test("Number.isNaN('37.37')", "false");
    test("Number.isNaN('37,5')", "false");
    test("Number.isNaN('123abc')", "false");
    test("Number.isNaN('')", "false");
    test("Number.isNaN(' ')", "false");
    test("Number.isNaN([])", "false");
    test("Number.isNaN([1])", "false");
    test("Number.isNaN([1, 2])", "false");

    test("isFinite(Infinity)", "false");
    test("isFinite(-Infinity)", "false");
    test("isFinite(NaN)", "false");
    test("isFinite(0)", "true");
    test("isFinite(12)", "true");
    test("isFinite(null)", "true");
    test("isFinite(false)", "true");
    test("isFinite('12')", "true");
    test("isFinite()", "false");

    test("Number.isFinite(Infinity)", "false");
    test("Number.isFinite(-Infinity)", "false");
    test("Number.isFinite(NaN)", "false");
    test("Number.isFinite(0)", "true");
    test("Number.isFinite(12)", "true");
    test("Number.isFinite(null)", "false");
    test("Number.isFinite(false)", "false");
    test("Number.isFinite('12')", "false");
    test("Number.isFinite()", "false");

    test("Number.isInteger(0)", "true");
    test("Number.isInteger(1)", "true");
    test("Number.isInteger(-100)", "true");
    test("Number.isInteger(0.1)", "false");
    test("Number.isInteger(Infinity)", "false");
    test("Number.isInteger(-Infinity)", "false");
    test("Number.isInteger('10')", "false");

    test("Number.NEGATIVE_INFINITY", "-Infinity");
    test("Number.POSITIVE_INFINITY", "Infinity");
    test("Number.MAX_SAFE_INTEGER", "9007199254740991");
    test("Number.MIN_SAFE_INTEGER", "-9007199254740991");
    test("Number.MAX_VALUE", "1.7976931348623157e+308");
    test("Number.MIN_VALUE", "5e-324");

    test("37.25.toString()", "\"37.25\"");
    test("255..toString(16)", "\"ff\"");
    test("255..toString(36)", "\"73\"");
    test("6..toString(2)", "\"110\"");
    test("(-10).toString(2)", "\"-1010\"");
    test("(10 ** 21.5).toString()", "\"3.1622776601683794e+21\"");
    test("(10 ** 21.5).toString(8)", "\"526665530627250154000000\"");
    test(
      " parseInt('CAFEBABE', 16).toString(2)",
      "\"11001010111111101011101010111110\"",
    );

    test("123.456.toFixed(2)", "\"123.46\"");
    test("0.004.toFixed(2)", "\"0.00\"");
    test("parseFloat('1.23e+5').toFixed(2)", "\"123000.00\"");
    test("(6.02 * 10 ** 23).toFixed(50)", "\"6.019999999999999e+23\"");
    test("(0.1600057092765239).toString(36)", "\"0.5rd85dm1ixq\"");
  }

  #[test]
  fn test_math() {
    test("String(Math)", "\"[object Math]\"");
    test("Math.PI", "3.141592653589793");

    test("Math.abs(-5)", "5");
    test("Math.abs(-5.25)", "5.25");
    test("Math.abs()", "NaN");

    test("Math.acos(-2)", "NaN");
    test("Math.acos(-1)", "3.141592653589793");
    test("Math.acos(1)", "0");

    test("Math.acosh(0)", "NaN");
    test("Math.acosh(1)", "0");
    test("Math.acosh(2)", "1.3169578969248166");
    test("Math.acosh(Infinity)", "Infinity");

    test("Math.asin(-2)", "NaN");
    test("Math.asin(-1)", "-1.5707963267948966");
    test("Math.asin(0)", "0");

    test("Math.asinh(-Infinity)", "-Infinity");
    test("Math.asinh(-1)", "-0.881373587019543");
    test("Math.asinh(0)", "0");

    test("Math.atan(-Infinity)", "-1.5707963267948966");
    test("Math.atan(0)", "0");
    test("Math.atan(1)", "0.7853981633974483");

    test("Math.atanh(-2)", "NaN");
    test("Math.atanh(-1)", "-Infinity");
    test("Math.atanh(0)", "0");
    test("Math.atanh(0.5)", "0.5493061443340549");

    test("Math.atan2(90, 15)", "1.4056476493802699");
    test("Math.atan2(15, 90)", "0.16514867741462683");

    test("Math.cbrt(-Infinity)", "-Infinity");
    test("Math.cbrt(-1)", "-1");
    test("Math.cbrt(0)", "0");
    test("Math.cbrt(1)", "1");
    test("Math.cbrt(2)", "1.2599210498948732");

    test("Math.ceil(-Infinity)", "-Infinity");
    test("Math.ceil(-7.004)", "-7");
    test("Math.ceil(-4)", "-4");
    test("Math.ceil(-0.95)", "0");
    test("Math.ceil(0.95)", "1");
    test("Math.ceil(4)", "4");
    test("Math.ceil(7.004)", "8");
    test("Math.ceil(Infinity)", "Infinity");

    test("Math.clz32(1)", "31");
    test("Math.clz32(4)", "29");
    test("Math.clz32(1000)", "22");
    test("Math.clz32()", "32");

    test("Math.cos(-Infinity)", "NaN");
    test("Math.cos(0)", "1");
    test("Math.cos(1)", "0.5403023058681398");
    test("Math.cos(Math.PI)", "-1");
    test("Math.cos(2 * Math.PI)", "1");
    test("Math.cos(Infinity)", "NaN");

    test("Math.cosh(-Infinity)", "Infinity");
    test("Math.cosh(-1)", "1.5430806348152437");
    test("Math.cosh(0)", "1");
    test("Math.cosh(1)", "1.5430806348152437");
    test("Math.cosh(Infinity)", "Infinity");

    test("Math.exp(-Infinity)", "0");
    test("Math.exp(-1)", "0.36787944117144233");
    test("Math.exp(0)", "1");
    test("Math.exp(1)", "2.718281828459045");
    test("Math.exp(Infinity)", "Infinity");

    test("Math.expm1(-Infinity)", "-1");
    test("Math.expm1(-1)", "-0.6321205588285577");
    test("Math.expm1(0)", "0");
    test("Math.expm1(1)", "1.7182818284590453");
    test("Math.expm1(Infinity)", "Infinity");

    test("Math.floor(-Infinity)", "-Infinity");
    test("Math.floor(-45.95)", "-46");
    test("Math.floor(-45.05)", "-46");
    test("Math.floor(0)", "0");
    test("Math.floor(4)", "4");
    test("Math.floor(45.05)", "45");
    test("Math.floor(45.95)", "45");
    test("Math.floor(Infinity)", "Infinity");

    test("Math.fround(1.5)", "1.5");
    test("Math.fround(1.337)", "1.3370000123977661");
    test("Math.fround(2 ** 150)", "Infinity");

    test("Math.hypot(3, 4)", "5");
    test("Math.hypot(5, 12)", "13");
    test("Math.hypot(3, 4, 5)", "7.0710678118654755");
    test("Math.hypot()", "0");
    test("Math.hypot(NaN)", "NaN");
    test("Math.hypot(NaN, Infinity)", "Infinity");
    test("Math.hypot(3, 4, '5')", "7.0710678118654755");
    test("Math.hypot(-3)", "3");

    test("Math.imul(2, 4)", "8");
    test("Math.imul(-1, 8)", "-8");
    test("Math.imul(-2, -2)", "4");
    test("Math.imul(0xffffffff, 5)", "-5");
    test("Math.imul(0xfffffffe, 5)", "-10");

    test("Math.log(-1)", "NaN");
    test("Math.log(0)", "-Infinity");
    test("Math.log(1)", "0");
    test("Math.log(10)", "2.302585092994046");
    test("Math.log(Infinity)", "Infinity");

    test("Math.log1p(-2)", "NaN");
    test("Math.log1p(-1)", "-Infinity");
    test("Math.log1p(0)", "0");
    test("Math.log1p(1)", "0.6931471805599453");
    test("Math.log1p(Infinity)", "Infinity");

    test("Math.log2(-2)", "NaN");
    test("Math.log2(0)", "-Infinity");
    test("Math.log2(1)", "0");
    test("Math.log2(2)", "1");
    test("Math.log2(3)", "1.584962500721156");
    test("Math.log2(1024)", "10");

    test("Math.log10(-2)", "NaN");
    test("Math.log10(0)", "-Infinity");
    test("Math.log10(1)", "0");
    test("Math.log10(2)", "0.3010299956639812");
    test("Math.log10(100000)", "5");

    test("Math.max(10, 20)", "20");
    test("Math.max(-10, -20)", "-10");
    test("Math.max(-10, 20)", "20");
    test("Math.max(-1, -3, -2)", "-1");
    test("Math.max()", "-Infinity");

    test("Math.min(2, 3, 1)", "1");
    test("Math.min(-2, -3, -1)", "-3");
    test("Math.min()", "Infinity");

    test("Math.pow(7, 3)", "343");
    test("Math.pow(4, 0.5)", "2");
    test("Math.pow(2, 10)", "1024");
    test("Math.pow(8, 1 / 3)", "2");
    test("Math.pow(8, -1 / 3)", "0.5");
    test("Math.pow(-7, 2)", "49");
    test("Math.pow(0, 0)", "1");
    test("Math.pow(Infinity, 0.1)", "Infinity");
    test("Math.pow(NaN, 0)", "1");

    test("Math.round(0.9)", "1");
    test("Math.round(-Infinity)", "-Infinity");
    test("Math.round(-20.51)", "-21");
    test("Math.round(-20.5)", "-20");
    test("Math.round(-0.1)", "0");
    test("Math.round(20.49)", "20");
    test("Math.round(20.5)", "21");
    test("Math.round(42)", "42");
    test("Math.round(Infinity)", "Infinity");

    test("Math.sign(3)", "1");
    test("Math.sign(-3)", "-1");
    test("Math.sign('-3')", "-1");
    test("Math.sign(0)", "0");
    test("Math.sign(NaN)", "NaN");
    test("Math.sign()", "NaN");

    test("Math.sin(-Infinity)", "NaN");
    test("Math.sin(0)", "0");
    test("Math.sin(1)", "0.8414709848078965");
    test("Math.sin(Math.PI / 2)", "1");
    test("Math.sin(Infinity)", "NaN");

    test("Math.sinh(-Infinity)", "-Infinity");
    test("Math.sinh(0)", "0");
    test("Math.sinh(1)", "1.1752011936438014");
    test("Math.sinh(Infinity)", "Infinity");

    test("Math.sqrt(-1)", "NaN");
    test("Math.sqrt(0)", "0");
    test("Math.sqrt(1)", "1");
    test("Math.sqrt(2)", "1.4142135623730951");
    test("Math.sqrt(9)", "3");
    test("Math.sqrt(Infinity)", "Infinity");

    test("Math.tan(-Infinity)", "NaN");
    test("Math.tan(0)", "0");
    test("Math.tan(1)", "1.557407724654902");
    test("Math.tan(Math.PI / 4)", "0.9999999999999999");
    test("Math.tan(Infinity)", "NaN");

    test("Math.tanh(-Infinity)", "-1");
    test("Math.tanh(0)", "0");
    test("Math.tanh(1)", "0.7615941559557649");
    test("Math.tanh(Infinity)", "1");

    test("Math.trunc(-Infinity)", "-Infinity");
    test("Math.trunc(-1.123)", "-1");
    test("Math.trunc(-0.123)", "0");
    test("Math.trunc(-0.123)", "0");
    test("Math.trunc(13.37)", "13");
    test("Math.trunc(42.84)", "42");
    test("Math.trunc(Infinity)", "Infinity");
  }
}
