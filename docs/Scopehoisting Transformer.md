# Scopehoisting Transformer

(Be sure to read [swc Visitors](swc%20Visitors.md) beforehand.)

("Non-static" refers to a variable being used in a way that cannot be optimized, such as `module.exports[someVariable] = 2`, or `import * as x from "..:"; console.log(x[someVariable]);`.)

The task of the hoist transformer is, in the simplest case, rewriting imports and exports, renaming the uses of the imports. The packager can then detect these `import "id:...";` statements to inline dependencies, replace `$id$import$foo` with the resolved expression, and generate necessary `$atlaspack$export(..., () => $id$export$b)` statements.

<table>
<tr><td>

```js
// a.js
import {b} from './b';
b();

// b.js
export let b = 2;
```

</td><td>

```js
// a.js
import 'id:./b';
$id$import$b$b();

// b.js
let $id$export$b = 2;
```

</td></tr>
</table>

While this is rather straight forward for pure ESM, a major source of complexity is having to handle arbitrary CJS while still optimizing as much as possible (non-static `module` accesses, non-top-level `require` calls, ...).

In addition to the code, it sets the symbols and various meta properties on both the asset and the dependencies:

- `asset.meta.id`: depending on which transformers run after the JS transformer, the value of `asset.id` will be different in packager from the id used for the various variables like `$id$export$foo`. The current asset id in the JS transformer is therefore stored.
- `asset.meta.hasCJSExports`: true if there is at least one CJS export
- `asset.meta.staticExports`: true if there is at least one CJS export that doesn't follow the pattern `module.exports.foo = ...`
- `asset.meta.shouldWrap`: Some constructs require this asset being wrapped in a `atlaspackRequire.register` block: top-level returns, non-static uses of `module`, eval, reassigning `module` or `exports`
- `dep.meta.shouldWrap`: this is a conditional require
- `dep.meta.promiseSymbol`: see the "Dynamic Imports" section

## Detecting non-static CJS imports/exports

A commonly used pattern is detecting some special case patterns such as top-level `var x = require("...");` or `aNamespaceObject.foo` or top-level `module.exports.foo = ...;` as high up in the visitor functions as possible and not traversing the children at all if there's a match.

So there is check for static top-level requires in `visit_module`, and if the `visit_expr` visitor is reached for `require("...")`, it is definitely a non-static (and conditional) require.

The `typeof` visitor doesn't traverse the children if the argument is `module`, so that `typeof module` doesn't count towards the non-static accesses to `module`.

## Self References

Because even `module.exports.foo = ...;` statements are detected and turned into symbols just like ESM exports, reading `module.exports` or `module.exports.foo` would naively not cause all of the exports to be preserved nor an namespace object to be generated (because looking at the graph and the symbol data, they are unused).

So instead, reading `module.exports` is expressed just like it is in ESM: by adding an import to the asset itself with the symbols being used. This is called a "self reference".

## Identifier Names

There are names to uniquely identify an import, the actual format doesn't actually matter for the code, as long as its used consistently (Atlaspack never re-parses these names to retrieve the parts again):

- `$x$import$y` = Asset with id `x` imported the namespace of the dependency with hashed source `y`
- `$x$import$y$z` = Asset with id `x` imported the hashed export `z` of the dependency with hashed source `y`
- `$x$require$y` = Asset with id `x` required the namespace the dependency with hashed source `y`

and to unique identify an export:

- `$x$exports` = The namespace exports object of the asset with id `x`
- `$x$exports$y` = The hashed export `y` of the asset with id `x`

(The symbol names are hashed because it's possible to have export names that are invalid Javascript identifiers: `module.exports["a b"] = 1;` or `export {x as "a b"}`, or via CSS modules.)

## Dynamic Imports

Dynamic imports such as `import("..").then(({ foo }) => log(foo));` will only cause `foo` to be used and not the entire asset. But at runtime, we still need a namespace object from which to access `off`. For this reason,

```js
import('./other.js').then(({foo}) => log(foo));
```

the dependency:

```
{
  promiseSymbol: '$assetId$importAsync$other'
  symbols: {
    'foo' => {
      local: '$assetId$importAsync$other$90a7f3efeed30595',
    }
  }
}
```

the generated code:

```js
import 'assetId:21eb38ddd81971f9';
$assetId$importAsync$other.then(({foo}) => log(foo));
```

So `import()` is replaced by an identifier that isn't actually listed in the symbols (because otherwise a symbol for `*` would prevent removing unused symbols), and this is the identifier stored in `dep.meta.promiseSymbol` which is then used for replacement in the packager.

## Preceding analysis pass: `Collect`

[This analysis](https://github.com/parcel-bundler/parcel/blob/9e2d5d0d60d08d65b5ae6cd765c907a8753bbf39/packages/transformers/js/core/src/hoist.rs#L1291) runs is used even without scope-hoisting, to generate symbols in development for deferring.

- collect which variable refers to an import/export
- find evals, non-static accesses of `module`, `exports`, ...,

## Actual transformation pass: `Hoist`

Some of the following steps are skipped when the asset was determined to be wrapped during `Collect` (stored in `self.collect.should_wrap`), since `module` and `exports` will be available in that case anyway and no rewriting has to happen for uses of these.

[fold_module](https://github.com/parcel-bundler/parcel/blob/9e2d5d0d60d08d65b5ae6cd765c907a8753bbf39/packages/transformers/js/core/src/hoist.rs#L138):

- match ESM import/export decls
  - store in `self.hoisted_import` and `self.reexports`, `self.exported_symbols`
  - imports are replaced with `import "...";`
  - for exports, just a `var $id$export = xyz` is left, the info what is imported/exported is kept in the maps
- match statically analyzable `var x = require("y");`.
  - similarly, the whole statement gets removed and replaced with `import "...";`,

Then, various replacements happen:

- [fold_ident](https://github.com/parcel-bundler/parcel/blob/9e2d5d0d60d08d65b5ae6cd765c907a8753bbf39/packages/transformers/js/core/src/hoist.rs#L756) looks up in `collect.imports` whether that identifier refers to an import (this renames expressions that refer to the variable as well as the names of the variable declarations themselves)

- fold_assign_expr

  - replace `module.exports = ...;` with `$id$exports = ...;`
  - replace `module.exports.foo = ...;` with `$id$exports$foo = ...;` and generate a corresponding hoisted `var $id$exports$x;` declaration.

- fold_expr:
  - replace `module.exports.foo` with `$id$export` identifier
  - replace `importedNs.foo` with `$id$import$foo` identifier
  - replace `require("x").foo` with `$id$import$foo` identifier
  - replace `require("x")` with `$id$import` identifier
  - replace `import("x")` with `$id$import` identifier
  - top-level `this` in ESM -> `undefined`
  - top-level `this` in CJS -> `module.exports`
  - wrap ESM imports with `(0, ...)` for correct `this`
