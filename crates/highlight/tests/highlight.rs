use parcel_highlight::{highlight, Class, HighlightSpan, Language};

/// Highlight and validate the structural invariants every consumer relies on:
/// spans are sorted, non-overlapping, in bounds, and on char boundaries.
fn styled(src: &str, lang: Language) -> Vec<(String, Class)> {
  let spans = highlight(src, lang);
  validate(src, &spans);
  spans
    .iter()
    .map(|s| (src[s.start..s.end].to_string(), s.class))
    .collect()
}

fn validate(src: &str, spans: &[HighlightSpan]) {
  let mut pos = 0;
  for span in spans {
    assert!(
      span.start >= pos && span.end >= span.start && span.end <= src.len(),
      "bad span {:?} at pos {}",
      span,
      pos
    );
    assert!(
      src.is_char_boundary(span.start) && src.is_char_boundary(span.end),
      "span not on char boundary: {:?}",
      span
    );
    pos = span.end;
  }
}

/// The class of the first span whose text is `text`.
#[track_caller]
fn class_of(styled: &[(String, Class)], text: &str) -> Class {
  styled
    .iter()
    .find(|(t, _)| t == text)
    .unwrap_or_else(|| panic!("no styled span with text {:?} in {:?}", text, styled))
    .1
}

#[track_caller]
fn assert_unstyled(styled: &[(String, Class)], text: &str) {
  assert!(
    !styled.iter().any(|(t, _)| t == text),
    "expected {:?} to be unstyled",
    text
  );
}

#[test]
fn js_basics() {
  let s = styled(
    r#"// comment
const n = obj.count + 0xFF + 12n;
let str = 'text';
"#,
    Language::Js,
  );
  assert_eq!(class_of(&s, "// comment"), Class::Comment);
  assert_eq!(class_of(&s, "const"), Class::Keyword);
  assert_eq!(class_of(&s, "count"), Class::Property);
  assert_eq!(class_of(&s, "0xFF"), Class::Number);
  assert_eq!(class_of(&s, "12n"), Class::Number);
  assert_eq!(class_of(&s, "'text'"), Class::String);
  assert_unstyled(&s, "obj");
}

#[test]
fn js_regex_vs_division() {
  let s = styled(
    r#"const re = /^[a-z"]+\/(\d+)/gi;
const half = size / 2 / scale;
"#,
    Language::Js,
  );
  assert_eq!(class_of(&s, r#"/^[a-z"]+\/(\d+)/gi"#), Class::Regex);
  assert_eq!(class_of(&s, "/"), Class::Operator);
}

#[test]
fn js_template_substitutions() {
  let s = styled("let x = `a${f(y)}b${z}c`;", Language::Js);
  assert_eq!(class_of(&s, "`a${"), Class::String);
  assert_eq!(class_of(&s, "}b${"), Class::String);
  assert_eq!(class_of(&s, "}c`"), Class::String);
  assert_eq!(class_of(&s, "f"), Class::Function);
  assert_unstyled(&s, "z");
}

#[test]
fn js_nested_templates() {
  let s = styled("tag`x${`inner ${d}`}y`;", Language::Js);
  assert_eq!(class_of(&s, "`inner ${"), Class::String);
  assert_eq!(class_of(&s, "}y`"), Class::String);
}

#[test]
fn js_identifier_heuristics() {
  let s = styled(
    "async function go() { new Map(); JSON.parse(x); a.b; obj.get(k); }",
    Language::Js,
  );
  assert_eq!(class_of(&s, "async"), Class::Keyword);
  assert_eq!(class_of(&s, "Map"), Class::Constructor);
  assert_eq!(class_of(&s, "JSON"), Class::CapsConst);
  assert_eq!(class_of(&s, "parse"), Class::Function);
  assert_eq!(class_of(&s, "b"), Class::Property);
  // `get` is a contextual keyword token, but here it's a method call.
  assert_eq!(class_of(&s, "get"), Class::Function);
}

#[test]
fn js_broken_code_keeps_highlighting() {
  // Stray brace, unterminated string, missing paren, unclosed template: the
  // code-frame case. Highlighting must survive on every line.
  let s = styled(
    r#"function broken(a, { {
  const s = 'unterminated string
  if (x { return /re/.test(s); }
  let t = `template ${ unclosed
}
"#,
    Language::Js,
  );
  // The unterminated string stops at end of line...
  assert_eq!(class_of(&s, "'unterminated string"), Class::String);
  // ...and the next lines still highlight fully.
  assert_eq!(class_of(&s, "if"), Class::Keyword);
  assert_eq!(class_of(&s, "/re/"), Class::Regex);
  assert_eq!(class_of(&s, "`template ${"), Class::String);
}

#[test]
fn js_stray_characters_recover() {
  let s = styled("const a = 1; \\ @ const b = 2;", Language::Js);
  assert_eq!(class_of(&s, "1"), Class::Number);
  assert_eq!(class_of(&s, "2"), Class::Number);
}

#[test]
fn ts_types() {
  let s = styled(
    "interface Options { mode: string }\ntype Alias = number;\nexport const x: Options = load();\n",
    Language::Ts,
  );
  assert_eq!(class_of(&s, "interface"), Class::Keyword);
  assert_eq!(class_of(&s, "type"), Class::Keyword);
  assert_eq!(class_of(&s, "Options"), Class::Constructor);
  assert_eq!(class_of(&s, "export"), Class::Keyword);
}

#[test]
fn jsx_elements() {
  let s = styled(
    r#"const v = <Layout.Main data-x:y="1">
  Text with an apostrophe: it's fine
  {list.map(x => <li key={x}>{x}</li>)}
  <br/>
</Layout.Main>;
"#,
    Language::Jsx,
  );
  assert_eq!(class_of(&s, "Layout"), Class::Tag);
  assert_eq!(class_of(&s, "Main"), Class::Tag);
  assert_eq!(class_of(&s, "data-x"), Class::Attribute);
  assert_eq!(class_of(&s, "\"1\""), Class::String);
  assert_eq!(class_of(&s, "li"), Class::Tag);
  assert_eq!(class_of(&s, "key"), Class::Attribute);
  assert_eq!(class_of(&s, "map"), Class::Function);
  assert_eq!(class_of(&s, "br"), Class::Tag);
  // JSX text (with its apostrophe) must not open a string.
  assert_unstyled(&s, "Text");
}

#[test]
fn jsx_unterminated_attribute_contained() {
  let s = styled(
    r#"const el = <div className="app>
  text
</div>;
const after = 'still highlighted';
"#,
    Language::Jsx,
  );
  // The unterminated attribute value stops at end of line (JSX strings are
  // legally multiline, but code frames favor containment)...
  assert_eq!(class_of(&s, "\"app>"), Class::String);
  // ...and code after the element still highlights.
  assert_eq!(class_of(&s, "'still highlighted'"), Class::String);
}

#[test]
fn json_values() {
  let s = styled(
    r#"{ "a": true, "b": null, "c": 42, "d": "text" }"#,
    Language::Json,
  );
  assert_eq!(class_of(&s, "\"a\""), Class::String);
  assert_eq!(class_of(&s, "true"), Class::Constant);
  assert_eq!(class_of(&s, "null"), Class::Constant);
  assert_eq!(class_of(&s, "42"), Class::Number);
}

#[test]
fn css_rules() {
  let s = styled(
    r#"@media (min-width: 600px) {
  .card:hover { color: #f04; margin: calc(100% - 2rem); /* note */ }
}
ul { padding: 0 }
"#,
    Language::Css,
  );
  assert_eq!(class_of(&s, "@media"), Class::Keyword);
  assert_eq!(class_of(&s, "min-width"), Class::Property);
  assert_eq!(class_of(&s, "600px"), Class::Number);
  assert_eq!(class_of(&s, "color"), Class::Property);
  assert_eq!(class_of(&s, "#f04"), Class::Constant);
  assert_eq!(class_of(&s, "calc("), Class::Function);
  assert_eq!(class_of(&s, "/* note */"), Class::Comment);
  assert_eq!(class_of(&s, "ul"), Class::Tag);
  // Pseudo-class, not a declaration.
  assert_unstyled(&s, "hover");
}

#[test]
fn css_broken_keeps_highlighting() {
  let s = styled(
    ".broken {\n  color: #f04;\n  margin: 10px\n.other { font-weight: bold }\n",
    Language::Css,
  );
  assert_eq!(class_of(&s, "color"), Class::Property);
  assert_eq!(class_of(&s, "font-weight"), Class::Property);
}

#[test]
fn css_style_attribute() {
  // A style attribute has no selector: start of input is declaration position.
  let s = styled("color: red; margin: 0", Language::CssDeclarations);
  assert_eq!(class_of(&s, "color"), Class::Property);
  assert_eq!(class_of(&s, "margin"), Class::Property);
  assert_unstyled(&s, "red");
}

#[test]
fn html_structure() {
  let s = styled(
    r#"<!DOCTYPE html>
<!-- comment -->
<div class="app" data-x='1' hidden>
  <p>Text with it's apostrophe</p>
  <img src="logo.svg" />
</div>
"#,
    Language::Html,
  );
  assert_eq!(class_of(&s, "<!DOCTYPE html>"), Class::Keyword);
  assert_eq!(class_of(&s, "<!-- comment -->"), Class::Comment);
  assert_eq!(class_of(&s, "<div"), Class::Tag);
  assert_eq!(class_of(&s, "class"), Class::Attribute);
  assert_eq!(class_of(&s, "\"app\""), Class::String);
  assert_eq!(class_of(&s, "hidden"), Class::Attribute);
  assert_eq!(class_of(&s, "/>"), Class::Tag);
  assert_unstyled(&s, "Text");
}

#[test]
fn html_embedded_script_and_style() {
  let s = styled(
    "<style>.a { color: red }</style>\n<script>const x = /re/g;</script>\n",
    Language::Html,
  );
  assert_eq!(class_of(&s, "color"), Class::Property);
  assert_eq!(class_of(&s, "const"), Class::Keyword);
  assert_eq!(class_of(&s, "/re/g"), Class::Regex);
  assert_eq!(class_of(&s, "</script"), Class::Tag);
}

#[test]
fn html_broken_tag_recovers() {
  let s = styled(
    "<span class=\"unterminated\n<b>next tag still works</b>\n",
    Language::Html,
  );
  assert_eq!(class_of(&s, "\"unterminated"), Class::String);
  assert_eq!(class_of(&s, "<b"), Class::Tag);
}

#[test]
fn pathological_inputs_stay_valid() {
  // No panics, no invalid spans, no infinite loops — content is irrelevant.
  let nasty = [
    "const a = `x${`inner ${d} 🎉`}y`;",
    "\\ \u{1F389} ' \" ` ${ /",
    "let re = /[😀-😆]+/u; x</",
    "`${`${`${`${x}`}`}`}`",
    "<T,>(x: T) => x",
    "",
    "\n\n\n",
  ];
  for src in nasty {
    for lang in [Language::Js, Language::Ts, Language::Tsx, Language::Jsx] {
      validate(src, &highlight(src, lang));
    }
    validate(src, &highlight(src, Language::Css));
    validate(src, &highlight(src, Language::Html));
  }
}
