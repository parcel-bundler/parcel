# swc Visitors

> If you're reading this and want to use swc for something other than the existing Atlaspack transformer, then you might find this template useful which contains all of the boilerplate to parse some input, give you the AST to work with, and finally also stringify it again: https://github.com/mischnic/swc-example

An swc visitor is a Rust struct that implements the Visit/Fold/VisitMut trait. Then you can take some AST node (e.g. the top-level `module`) and call `visit_with`:

```rust
struct Foo {
  some_state: Vec<JsWord>
}

impl Visit for Foo {
  // Default implementation for all other nodes:
  // fn visit_module(&mut self, node: &Ident) {
  //   node.visit_children_with(self);
  // }
  fn visit_expr(&mut self, node: &Expr) {
    println!("Some expression!");
    node.visit_children_with(self);
  }
  fn visit_ident(&mut self, node: &Ident) {
    self.some_state.push(node.sym);
  }
}

func main(){
  // ...
  let myVisitor = Foo { some_state: vec![] };
  module.visit_with(&mut myVisitor);
  // ...
}
```

If a function for some node type isn't declared, the default implementation uses `visit_children_with` to then visit all respective child nodes (and eventually also the functions declared in the impl).

Similarly, overriding such a function but not calling `visit_*` on some child nodes explicitly will then not visit the subtree at all (this really is a straight-forward recursive traversal).

These are all of the types of visitors (at least the ones used by Atlaspack):

- `Visit` (and then `visit_with`/`visit_children_with`):

  The function signatures are `fn visit_expr(&mut self, node: &Expr)`, so you get an immutable reference. This is useful for doing some analysis and no changes.

- `Fold` (and then `fold_with`/`fold_children_with`):

  The function signatures are `fn visit_expr(&mut self, node: Expr) -> Expr`, so you get the value and not just a reference to the node and also have to return the same node type again.

- `VisitMut` (and then `visit_mut_with`/`visit_mut_children_with`)

  The function signatures are `fn visit_mut_ident(&mut self, node: &mut Expr)` (so you get the value and not just a reference to the node), and also have to return the same node type again.

  At least in theory, this is faster than `Fold` because `Fold` has to copy the node values around even if nothing changes.

## Removing a node or replacing with a different node type

Let's try to replace `export function Foo(){}` with `function Foo(){}` in swc: first of all it's not possible to straight-up return a `VarDecl` in a `fn fold_export_decl(self, node: ExportDecl)`.

Instead, this logic need to be pulled up one level to the `ModuleItem`s

```rust
fn fold_module_item(&mut self, node: ModuleItem) -> ModuleItem {
  match node {
    ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
      decl: func @ Decl::Fn(_),
      ..
    })) => {
      return ModuleItem::Stmt(Stmt::Decl(func));
    },
    _ => {
      return node;
    },
  }
}
```

It's also not possible to return multiple nodes, so to add or remove nodes (be it statements, variable declarators), also visit the parent and access the array of children (`body` in the case of the module).

```rust
fn fold_module(&mut self, node: Module) -> Module {
  let mut res = node.fold_children_with(self);
  if let Some(foo) = self.something {
    res.body.insert(0, ast::ModuleItem::Stmt(foo));
  }
  res
}
```

## Identifiers/scopes

The type used to represent identifiers is `JsWord` (as opposed to a regular `String` or `&str`). This is a special interned string, to construct it for an arbitrary string, you can use `.into()`. Strings that are part of the hard-coded [list of interned words](https://github.com/swc-project/swc/blob/a8748a9191a249fd2a97207cbcf0c3317b1bc1e3/crates/swc_atoms/words.txt#L1) can be retrieved more efficiently by using the `js_word!` macros, trying to use that macro with a string that is not part of the list results in a compile time error.

```rust
  let x: JsWord = "something".into();
  let y: JsWord = js_word!("require") // or "URL", "default", "eval", ...

  let ident: Ident; // the ast node
  ident.sym // the JsWord "string"
  ident.span.ctxt // the syntax context
```

`@babel/traverse` has the concept of scopes to determine if variables refer to the same binding. swc uses `SyntaxContext` (which is internally just a unique number), with the idea that the pair `(JsWord, SyntaxContext)` refers to the unique (and correct) variable binding (even if there are some `Ident` nodes that have the same string). swc's `hygiene()` visitor then "flushes" this information by renaming identifiers to have unique names (which has to happen before codegen because the actual, textual Javascript format of course doesn't know about syntax contexts).

That means to store a list of variable bindings somewhere (e.g. if you know that it's a top level binding and want to store that information), instead of just `JsWord`, the pair of `(JsWord, SyntaxContext)` should be used. (swc has a type for this pair: `Id`, and `ident.to_id()` is a useful helper here).

## `visit_ident`

Node that the `Ident` visitor function has be used with caution as these nodes are not just identifiers that refer to a variable binding, but any kind of "name" in the AST (e.g. when destructuring, for member accesses, private class variables).

```rust
fn fold_ident(&mut self, node: &Ident) -> Ident {
  Ident::new("foo".into(), DUMMY_SP)
}
// and the other visit, visit_mut variants...
```

will result in

```js
function foo(foo) {
  foo.foo(foo);
}
const foo = {foo: foo};
class foo {
  #foo;
  foo() {
    foo(this.#foo);
  }
}
```

## Logic based on existence of an ancestor

In some cases, it's only necessary to know whether there exists some parent node matching a condition, but it doesn't have to be actually read or modified (e.g. when replacing `this` but only when not inside a function).

A pattern for this use case is a variable on the struct that is modified when this condition changes.

```rust
struct Foo {
  in_function_scope: bool,
}

impl Visit for Foo {
  fn visit_function(&mut self, node: &Function) {
      let old = self.in_function_scope;
      self.in_function_scope = true;
      node.visit_children_with(self);
      self.in_function_scope = old;
  }

  fn visit_expr(&mut self, node: &Expr) {
    if let Expr::This(_this) = node {
      println!(self.in_function_scope);
    }
  }
}
```
