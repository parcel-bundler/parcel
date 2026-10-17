use std::borrow::Cow;

use crate::transformer::{
  Config, MDX_COMPONENTS, SourceLocation,
  utils::{Diagnostic, DiagnosticSeverity, diagnostic},
};
use markdown::{
  Location,
  mdast::{AttributeValueExpression, Code, MdxjsEsm, Node, Text},
  message::{Message, Place},
  unist::Position,
};
use mdxjs::{
  Options,
  hast::{AttributeContent, AttributeValue, MdxJsxAttribute},
  hast_util_to_swc, mdast_util_from_mdx, mdast_util_to_hast, mdx_plugin_recma_document,
  mdx_plugin_recma_jsx_rewrite,
};
use rustc_hash::FxHashSet;
use swc_core::{
  common::{DUMMY_SP, GLOBALS, Globals, Mark, SourceMap, comments::Comments, sync::Lrc},
  ecma::{
    ast::{
      ArrayLit, BindingIdent, CallExpr, Callee, Decl, ExportDecl, ExportDefaultExpr,
      ExportSpecifier, Expr, ExprOrSpread, Ident, JSXAttrName, JSXAttrOrSpread, JSXAttrValue,
      JSXElementName, JSXExpr, JSXExprContainer, JSXOpeningElement, Lit, Module, ModuleDecl,
      ModuleItem, Pat, Stmt, VarDecl, VarDeclarator,
    },
    codegen::to_code,
    parser::{EsSyntax, Parser, StringInput, Syntax, TsSyntax, lexer::Lexer},
    transforms::base::{hygiene::hygiene, resolver},
    visit::{VisitMut, VisitMutWith},
  },
  quote,
};
use swc_node_comments::SwcComments;

pub struct MdxResult {
  pub module: Module,
  pub comments: SwcComments,
  pub assets: Vec<MdxAsset>,
}

#[derive(Debug)]
pub struct MdxAsset {
  pub lang: String,
  pub code: String,
  pub position: Option<Position>,
}

pub fn mdx(config: &Config) -> Result<MdxResult, Diagnostic> {
  compile(config).map_err(message_to_diagnostic)
}

fn compile(config: &Config) -> Result<MdxResult, Message> {
  let mut options: Options = Options {
    filepath: Some(config.filename.clone()),
    development: config.is_development,
    jsx: true,
    ..Default::default()
  };

  let code = unsafe { std::str::from_utf8_unchecked(&config.code) };
  let mut ast = mdast_util_from_mdx(code, &options)?;
  let mut contents: Vec<_> = Vec::new();
  toc(&ast, &mut contents);

  let mut assets = Vec::new();
  transform_code(&mut ast, &mut assets);
  if !assets.is_empty() {
    options.provider_import_source = Some(MDX_COMPONENTS.into());
    let children = ast.children_mut().unwrap();
    let imports = (0..assets.len()).map(|i| {
      Node::MdxjsEsm(MdxjsEsm {
        value: format!("import __parcelMdxImport{} from 'mdx-{}'", i, i),
        position: None,
        stops: vec![],
      })
    });
    children.extend(imports);
  }

  let hast = mdast_util_to_hast(&ast);
  let location = Location::new(code.as_bytes());
  let mut explicit_jsxs = FxHashSet::default();
  let mut program = hast_util_to_swc(&hast, &options, Some(&location), &mut explicit_jsxs)?;

  program.module.visit_mut_with(&mut DependencyVisitor);

  mdx_plugin_recma_document(&mut program, &options, Some(&location))?;
  mdx_plugin_recma_jsx_rewrite(&mut program, &options, Some(&location), &explicit_jsxs)?;

  let comments = SwcComments::default();
  for c in program.comments {
    comments.add_leading(c.span.lo, c.clone());
  }

  program
    .module
    .body
    .push(ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
      decl: Decl::Var(Box::new(VarDecl {
        decls: vec![VarDeclarator {
          name: Pat::Ident(BindingIdent {
            id: Ident::new_no_ctxt("tableOfContents".into(), DUMMY_SP),
            ..Default::default()
          }),
          definite: false,
          init: Some(Box::new(TocNode::to_array(contents))),
          span: DUMMY_SP,
        }],
        ..Default::default()
      })),
      span: DUMMY_SP,
    })));

  Ok(MdxResult {
    module: program.module,
    comments,
    assets,
  })
}

#[derive(Debug, Clone)]
pub struct TocNode {
  pub title: String,
  pub level: u8,
  pub children: Vec<TocNode>,
}

fn toc(node: &Node, results: &mut Vec<TocNode>) {
  match node {
    Node::Heading(heading) => {
      let toc = TocNode {
        title: text(node).into_owned(),
        level: heading.depth,
        children: Vec::new(),
      };

      let mut children = results;
      while let Some(last) = children.last() {
        if toc.level > last.level {
          children = &mut children.last_mut().unwrap().children;
        } else {
          break;
        }
      }
      children.push(toc);
    }
    _ => {
      if let Some(children) = node.children() {
        for child in children {
          toc(child, results)
        }
      }
    }
  }
}

impl TocNode {
  pub fn to_array(nodes: Vec<TocNode>) -> Expr {
    Expr::Array(ArrayLit {
      span: DUMMY_SP,
      elems: nodes
        .into_iter()
        .map(|c| {
          Some(ExprOrSpread {
            expr: Box::new(c.into_expr()),
            spread: None,
          })
        })
        .collect(),
    })
  }

  pub fn into_expr(self) -> Expr {
    let children = TocNode::to_array(self.children);
    quote!("{title: $title, level: $level, children: $children}" as Expr, title: Expr = self.title.into(), level: Expr = (self.level as f64).into(), children: Expr = children)
  }
}

fn text<'a>(node: &'a Node) -> Cow<'a, str> {
  match node {
    Node::Text(text) => Cow::Borrowed(&text.value),
    _ => {
      let mut result = Cow::Borrowed("");
      if let Some(children) = node.children() {
        for child in children {
          result += text(child);
        }
      }
      result
    }
  }
}

struct DependencyVisitor;

impl VisitMut for DependencyVisitor {
  fn visit_mut_jsx_opening_element(&mut self, node: &mut JSXOpeningElement) {
    node.visit_mut_children_with(self);

    let element = match &node.name {
      JSXElementName::Ident(id) => id.sym.as_str(),
      _ => return,
    };

    for prop in &mut node.attrs {
      if let JSXAttrOrSpread::JSXAttr(prop) = prop {
        if let (JSXAttrName::Ident(name), Some(JSXAttrValue::Str(specifier))) =
          (&prop.name, &prop.value)
        {
          if is_url(element, name.sym.as_str())
            && !specifier.value.starts_with("?")
            && !specifier.value.starts_with("#")
          {
            prop.value = Some(JSXAttrValue::JSXExprContainer(JSXExprContainer {
              expr: JSXExpr::Expr(Box::new(Expr::Call(CallExpr {
                callee: Callee::Expr(Box::new(Expr::Ident(Ident::new_no_ctxt(
                  "__parcel_url_dep__".into(),
                  DUMMY_SP,
                )))),
                args: vec![
                  ExprOrSpread {
                    expr: Box::new(Expr::Lit(Lit::Str(specifier.clone()))),
                    spread: None,
                  },
                  ExprOrSpread {
                    expr: Box::new(Expr::Lit(Lit::Bool(
                      (element == "a" || element == "iframe").into(),
                    ))),
                    spread: None,
                  },
                ],
                ..Default::default()
              }))),
              span: prop.span,
            }));
          }
        }
      }
    }
  }
}

fn is_url(el: &str, prop: &str) -> bool {
  matches!(
    (el, prop),
    ("img", "src")
      | ("audio", "src")
      | ("video", "src")
      | ("video", "poster")
      | ("source", "src")
      | ("track", "src")
      | ("iframe", "src")
      | ("script", "src")
      | ("embed", "src")
      | ("a", "href")
      | ("link", "href")
      | ("use", "href")
      | ("use", "xlink:href")
      | ("script", "href")
      | ("script", "xlink:href")
      | ("image", "href")
      | ("image", "xlink:href")
  )
}

/// Transform code fences with language and meta string into <CodeBlock> components.
fn transform_code(node: &mut Node, assets: &mut Vec<MdxAsset>) {
  match node {
    Node::Code(code) if code.lang.is_some() => {
      if let Some(replacement) = parse_code_block(code, assets) {
        *node = replacement;
      }
    }
    _ => {
      if let Some(children) = node.children_mut() {
        for child in children {
          transform_code(child, assets);
        }
      }
    }
  }
}

fn parse_code_block(code: &Code, assets: &mut Vec<MdxAsset>) -> Option<Node> {
  // Parse meta string as JSX props.
  let ast = if let Some(meta) = &code.meta {
    mdast_util_from_mdx(&format!("<CodeBlock {} />", meta), &Default::default()).ok()?
  } else {
    mdast_util_from_mdx("<CodeBlock />", &Default::default()).ok()?
  };

  if let Node::Root(root) = ast {
    let mut node = root.children.into_iter().next().unwrap();
    if let Node::MdxJsxFlowElement(ref mut element) = node {
      if let Some(lang) = &code.lang {
        element
          .attributes
          .push(AttributeContent::Property(MdxJsxAttribute {
            name: "lang".into(),
            value: Some(AttributeValue::Literal(lang.clone())),
          }));

        // Create an asset if the `render` prop is set to true.
        if let Some(attr_idx) = element
          .attributes
          .iter()
          .position(|attr| matches!(attr, AttributeContent::Property(p) if p.name == "render"))
        {
          if matches!(lang.as_str(), "js" | "jsx" | "ts" | "tsx") {
            if let AttributeContent::Property(attr) = &mut element.attributes[attr_idx] {
              let (block_code, is_component) = transform_js_code_block(&code.value, lang);
              // A component is rendered here, so the example module only exports the component.
              // That lets React Refresh update it in place.
              let import = format!("__parcelMdxImport{}", assets.len());
              attr.value = Some(AttributeValue::Expression(AttributeValueExpression {
                value: if is_component {
                  format!("<{} />", import)
                } else {
                  import
                },
                stops: vec![],
              }));

              assets.push(MdxAsset {
                lang: lang.clone(),
                code: block_code,
                position: code.position.clone(),
              });
            }
          } else {
            element.attributes.remove(attr_idx);
            assets.push(MdxAsset {
              lang: lang.clone(),
              code: code.value.to_owned(),
              position: code.position.clone(),
            });
          }
        }
      }

      element.children = vec![Node::Text(Text {
        value: code.value.clone(),
        position: code.position.clone(),
      })];
      element.position = code.position.clone();
      return Some(node);
    }
  }

  None
}

/// Exports the code block's last declaration or expression if it has no default export. Returns the
/// code, and whether its default export is now a component, which the page renders, rather than a
/// value it renders as is.
fn transform_js_code_block(code: &str, lang: &str) -> (String, bool) {
  let code = code.to_owned();
  let source_map = Lrc::new(SourceMap::default());
  let source_file =
    source_map.new_source_file(Lrc::new(swc_core::common::FileName::Anon), code.clone());

  let lexer = Lexer::new(
    if lang == "ts" || lang == "tsx" {
      Syntax::Typescript(TsSyntax {
        tsx: lang == "tsx",
        ..Default::default()
      })
    } else {
      Syntax::Es(EsSyntax {
        jsx: lang == "jsx",
        ..Default::default()
      })
    },
    Default::default(),
    StringInput::from(&*source_file),
    None,
  );

  let mut parser = Parser::new_from(lexer);
  let mut module = match parser.parse_module() {
    Err(_) => return (code, false),
    Ok(module) => module,
  };

  // The added export refers to identifiers with their syntax contexts, and `hygiene` renames the
  // wrapper component if its name is taken.
  let globals = Globals::new();
  GLOBALS.set(&globals, || {
    let unresolved_mark = Mark::new();
    let top_level_mark = Mark::new();
    module.visit_mut_with(&mut resolver(
      unresolved_mark,
      top_level_mark,
      lang == "ts" || lang == "tsx",
    ));

    // Export the last declaration or expression if there are no explicit exports.
    let mut is_component = false;
    if !has_default_export(&module) {
      // React Refresh requires component names to start with a capital letter.
      let wrapper_name = Ident::new_private("Example".into(), DUMMY_SP);
      let mut export_name = None;
      for item in module.body.iter_mut().rev() {
        match item {
          ModuleItem::Stmt(Stmt::Decl(decl)) => {
            match decl {
              Decl::Class(c) => {
                export_name = Some(c.ident.clone());
              }
              Decl::Fn(f) => {
                export_name = Some(f.ident.clone());
              }
              _ => continue,
            }
            break;
          }
          ModuleItem::Stmt(Stmt::Expr(expr)) => {
            let value = expr.expr.clone();
            *item = if is_jsx(&value) {
              // Wrapped in a component so that React Refresh can update it.
              is_component = true;
              quote!(
                "export default function $name() { return $value; }" as ModuleItem,
                name = wrapper_name,
                value: Expr = *value,
              )
            } else {
              ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultExpr(ExportDefaultExpr {
                expr: value,
                span: expr.span,
              }))
            };
            break;
          }
          _ => {}
        }
      }

      if let Some(export_name) = export_name {
        is_component = true;
        module
          .body
          .push(ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultExpr(
            ExportDefaultExpr {
              expr: Box::new(Expr::Ident(export_name)),
              span: DUMMY_SP,
            },
          )));
      }
    }

    module.visit_mut_with(&mut hygiene());
    (to_code(&module), is_component)
  })
}

fn is_jsx(expr: &Expr) -> bool {
  match expr {
    Expr::JSXElement(_) | Expr::JSXFragment(_) => true,
    Expr::Paren(paren) => is_jsx(&paren.expr),
    _ => false,
  }
}

fn has_default_export(module: &Module) -> bool {
  module.body.iter().any(|item| match item {
    ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(_))
    | ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultExpr(_)) => true,
    ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(n)) => n.specifiers.iter().any(|s| match s {
      ExportSpecifier::Default(_) => true,
      ExportSpecifier::Namespace(_) => false,
      ExportSpecifier::Named(named) => {
        matches!(&named.exported, Some(exported) if exported.atom().as_str() == "default")
      }
    }),
    _ => false,
  })
}

fn message_to_diagnostic(message: Message) -> Diagnostic {
  let loc = message.place.map(|place| match *place {
    Place::Point(point) => SourceLocation {
      start_line: point.line,
      start_col: point.column,
      end_line: point.line,
      end_col: point.column + 1,
    },
    Place::Position(pos) => SourceLocation {
      start_line: pos.start.line,
      start_col: pos.start.column,
      end_line: pos.end.line,
      end_col: pos.end.column,
    },
  });

  diagnostic(
    message.reason,
    loc.map(|loc| loc.to_highlight(None)).into_iter().collect(),
    DiagnosticSeverity::Error,
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn imports_mdx_components() {
    let result = mdx(&Config {
      filename: "index.mdx".into(),
      code: b"```js render\nconsole.log('test');\n```".to_vec(),
      ..Default::default()
    })
    .unwrap();

    assert_eq!(result.assets.len(), 1);
    assert!(to_code(&result.module).contains(r#"from "@parcel/parcel3/src/mdx-components""#));
  }

  /// Compiles a page with one rendered code block, returning the block's code and the page's.
  fn render_code_block(block: &str) -> (String, String) {
    let result = mdx(&Config {
      filename: "index.mdx".into(),
      code: format!("```jsx render\n{}\n```", block).into_bytes(),
      ..Default::default()
    })
    .unwrap();
    assert_eq!(result.assets.len(), 1);
    (result.assets[0].code.clone(), to_code(&result.module))
  }

  #[test]
  fn code_block_exports_its_last_declaration_as_a_component() {
    let (block, page) = render_code_block("function Example() { return <div />; }");
    assert!(block.contains("export default Example;"), "{block}");
    // The page renders it.
    assert!(page.contains("render={<__parcelMdxImport0/>}"), "{page}");
  }

  #[test]
  fn code_block_wraps_its_last_jsx_expression_in_a_component() {
    let (block, page) = render_code_block("<div>hi</div>");
    assert!(
      block.contains("export default function Example() {\n    return <div>hi</div>;"),
      "{block}"
    );
    assert!(page.contains("render={<__parcelMdxImport0/>}"), "{page}");
  }

  #[test]
  fn code_block_component_wrapper_does_not_conflict_with_its_declarations() {
    let (block, _) =
      render_code_block("function Example({children}) { return children; }\n<Example>hi</Example>");
    assert!(block.contains("function Example({ children })"), "{block}");
    assert!(
      block.contains("export default function Example1() {\n    return <Example>hi</Example>;"),
      "{block}"
    );
  }

  #[test]
  fn code_block_exports_other_last_expressions_as_values() {
    let (block, page) = render_code_block("'hello'");
    assert!(block.contains("export default 'hello';"), "{block}");
    assert!(page.contains("render={__parcelMdxImport0}"), "{page}");
  }

  #[test]
  fn code_block_keeps_an_explicit_default_export() {
    let (block, page) = render_code_block("export default <div />;");
    assert!(block.contains("export default <div/>;"), "{block}");
    assert!(page.contains("render={__parcelMdxImport0}"), "{page}");
  }
}
