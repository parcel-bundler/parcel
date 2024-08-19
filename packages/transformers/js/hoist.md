# SWC scope hoisting

This document describes how the SWC-based scope hoisting implementation works, in comparison to the previous implementation.

## Overview

Scope hoisting is the process of combining multiple JavaScript modules together into a single scope. This enables dead code elimination (aka tree shaking) to be more effective, and improves runtime performance by making cross-module references static rather than dynamic property lookups.

Atlaspack has historically implemented scope hoisting in JavaScript on top of Babel ASTs. It operated in 3 phases:

1. Hoist - on an individual module, rename all top-level variables to be unique, and perform static analysis on imports and exports to produce symbol data. This prepares the module to be concatenated safely with other modules.
2. Concat - concatenate all modules together into a single scope, following the order of `$atlaspack$require` calls inserted by the hoist phase. This also handled wrapping modules that were required from a non-top-level statement to preserve side effect ordering. Operates on module ASTs.
3. Link - replace temporary imported variable names with the resolved exported variable names from the imported module. In addition, output formats are handled here along with some dead code elimination. Operates on a single concatenated AST.

The new scope hoisting implementation operates in just two phases.

1. Hoist - similar to the previous hoist implementation, but redesigned to allow subsequent phases to operate only using strings rather than ASTs for performance. This part is implemented in Rust.
2. Packaging - This is a combination of the previous concat and link phases into a single phase, that does simple string replacements to match up imports and exports. In addition, wrapping of assets to preserve side effect ordering is done here, as well as insertion of exports namespace objects if needed.

## Transforming

The hoist phase should do as much work as possible as it operates on ASTs and and in parallel on individual files. It's also implemented in Rust using SWC for performance.

This is implemented in two passes. The first pass analyzes and collects data about the module, which is used in the second pass, which actually transforms the module.

In the first pass, we collect:

1. All imported/required variable names. This allows us to track static and non-static accesses of these variables to determine what symbols of a dependency are used.
2. All exported variable names. This allows us to easily rename them later.
3. All non-static member expressions and other accesses. This allows us to determine later whether we need to access a namespace object or if we can statically resolve all symbols of a dependency. We also track when a dependency is accessed non-statically by other means (e.g. a non-static destructuring assignment).
4. Whether the CommonJS `exports` object is referenced non-statically. This means we will need to always use the namespace rather than resolving exports statically.
5. Dependencies that need to be wrapped because they were required anywhere except a top-level variable declaration, e.g. inside a function. These deps need to be wrapped to preserve side effect ordering.
6. Whether something in _this_ module requires us to wrap, e.g. `eval`, top-level return, non-static `module` access, `exports` re-assignment, etc.

In the second pass, we transform:

1. For each import statement, a new import like `import "module_id:dep_specifier";` is hoisted to the top of the module. This indicates where the dependency code should be inserted by the packager later.
2. For `require` calls, an import like above is inserted before the current top-level statement. This is new in this version, and prevents us needing to search for `$atlaspack$require` calls in statements to find where to insert the code in the packager. If the require is anywhere except a top-level variable declaration, it is marked as wrapped to preserve side effect ordering (also more conservative than before). The require is replaced by an identifier referencing the `*` symbol in the dependency, or the relevant symbol if in a statically resolvable member expression.
3. Each export statement is replaced by its declaration/expression, if any, and renamed.
4. CommonJS exports are replaced with variable assignments. If the CJS exports object is accessed non-statically, as determined in the previous phase, then an assignment to an object is emitted, otherwise each export is an individual variable.
5. References to imports/requires are replaced with a renamed variable, and added to the symbols. If we previously determined in the first phase that the import was accessed non-statically, a member expression is used for all references to that dependency.
6. All top-level variables are renamed to include the module id so that they can be concatenated together safely. This is skipped if the module needs to be wrapped, e.g. used `eval`.

The output from Rust is an object which is used by the JSTransformer Atlaspack plugin to add symbols to dependencies and the asset itself, along with some metadata that is used by the packager.

## Packaging

The packager operates purely on strings now rather than ASTs. This makes it much faster since it doesn't need to deserialize a bunch of ASTs from disk and perform codegen.

The packager visits dependencies recursively, starting from the bundle entries, and following the `import` statements left by the hoist transform. It resolves the import specifiers to dependencies, follows the dependency to a resolved asset, and then recursively processes that asset. The `import` statement is replaced by the processed code of the dependency.

For each asset, we look at the symbols used by each dependency and resolve them to their final location, following re-exports. This is done by Atlaspack core in the bundle graph. We perform a string replacement for each temporary import name to the final resolved symbol. If the resolved asset is wrapped, we use `atlaspackRequire` to load it, and if it has non-static exports, we use a member expression on the namespace object.

The packager also synthesizes the exports object when needed. If the namespace is used, the asset has non-static exports, or it is wrapped, a namespace is declared, and each used symbol is added to the namespace using the `$atlaspack$export` helper. This is different from the previous implemetation, which added the exports object in the link phase, and then _removed_ it if unnecessary in the link phase. Now we do the opposite, which makes it possible to operate on strings rather than ASTs.

If the asset is wrapped, we use the `atlaspackRequire.register` function to register it in a module map. This is used both when the asset is required in a non top-level context, and also when the asset has non-statically analyzable code (e.g. `eval`). Previously we wrapped in hoist for the latter. In this case, a `module` and `exports` object are passed in, and we use those instead of the locally declared exports object, which makes circular dependencies work.

## Summary of differences

- requires and imports are now replaced with top-level `import "module_id:specifier"` statements rather than inline `$atlaspack$require` calls. This indicates where to insert the dependent code, and no longer requires the packager to search for requires inside statements.
- THe hoist transform is much more conservative. Only top-level variable declarations pointing to a `require` or a member expression with a `require` are handled without wrapping. This should solve cases like [#5606](https://github.com/parcel-bundler/parcel/issues/5606). In addition, if any non-static access of an import occurs, we always use the namespace object rather than using static references for some imports and dynamic references for others. Same goes for exports.
- Hoist no longer performs any wrapping. All wrapping is now handled in the packager.
- The packager operates only on strings and does not require any ASTs.
- The export namespace object is not generated in the hoist phases and instead is synthesized only when needed during packaging (e.g. if the module is accessed non-statically). This applies to both ESM and fully statically analyzable CJS. For CJS with exports that are non-static, the hoist phase still performs assignments to a namespace object.
- We use `atlaspackRequire.register` for wrapping rather than `$init` calls. This should allow us to share a module map between bundles and solve some side effect ordering/circular dependency issues.

## Examples

The following examples demonstrate how the scope hoisting implementation works.

### ESM -> ESM

#### Input

```js
// a.js
import {b} from './b';
b();

// b.js
let b = 2;
export {b};
```

#### Hoist output

```js
// a.js
import 'id:./b';
$id$import$b$b();

// b.js
let $id$export$b = 2;
```

imported symbols:

| Local          | Specifier | Imported |
| -------------- | --------- | -------- |
| $id$import$b$b | ./b       | b        |

exported symbols:

| Exported | Local         |
| -------- | ------------- |
| b        | $id$export\$b |

#### Packaged output

```js
let $id$export$b = 2;
$id$export$b$b();
```

### ESM -> Static CJS

#### Input

```js
// a.js
import {b} from './b';
b();

// b.js
exports.b = 2;
```

#### Hoist output

```js
// a.js
import 'id:./b';
$id$import$b$b();

// b.js
let $id$export$b = 2;
```

imported symbols:

| Local          | Specifier | Imported |
| -------------- | --------- | -------- |
| $id$import$b$b | ./b       | b        |

exported symbols:

| Exported | Local         |
| -------- | ------------- |
| b        | $id$export\$b |

#### Packaged output

```js
let $id$export$b = 2;
$id$export$b();
```

### Static CJS -> Static CJS

#### Input

```js
// a.js
const {b} = require('./b');
b();

// b.js
exports.b = 2;
```

#### Hoist output

```js
// a.js
import 'id:./b';
$id$import$b$b();

// b.js
let $id$export$b = 2;
```

imported symbols:

| Local          | Specifier | Imported |
| -------------- | --------- | -------- |
| $id$import$b$b | ./b       | b        |

exported symbols:

| Exported | Local         |
| -------- | ------------- |
| b        | $id$export\$b |

#### Packaged output

```js
let $id$export$b = 2;
$id$export$b();
```

### Static CJS -> ESM

#### Input

```js
// a.js
const {b} = require('./b');
b();

// b.js
let b = 2;
export {b};
```

#### Hoist output

```js
// a.js
import 'id:./b';
$id$import$b$b();

// b.js
let $id$export$b = 2;
```

imported symbols:

| Local          | Specifier | Imported |
| -------------- | --------- | -------- |
| $id$import$b$b | ./b       | b        |

exported symbols:

| Exported | Local         |
| -------- | ------------- |
| b        | $id$export\$b |

#### Packaged output

```js
let $id$export$b = 2;
$id$export$b();
```

### Non-static require -> Static exports

#### Input

```js
// a.js
const b = require('./b');
b[something]();

// b.js
exports.foo = 2;
```

#### Hoist output

```js
// a.js
import 'id:./b';
$id$import$b[something]();

// b.js
let $id$export$foo = 2;
```

imported symbols:

| Local         | Specifier | Imported |
| ------------- | --------- | -------- |
| $id$import\$b | ./b       | \*       |

exported symbols:

| Exported | Local           |
| -------- | --------------- |
| foo      | $id$export\$foo |

#### Packaged output

```js
let $id$export$foo = 2;
let $id$exports = {};
$atlaspack$export($id$exports, 'foo', () => $id$export$foo);
$id$exports[something]();
```

### Static require -> Non-static exports

#### Input

```js
// a.js
const b = require('./b');
b.foo();

// b.js
exports[something] = 2;
```

#### Hoist output

```js
// a.js
import 'id:./b';
$id$import$b$foo();

// b.js
$id$exports[something] = 2;
```

imported symbols:

| Local            | Specifier | Imported |
| ---------------- | --------- | -------- |
| $id$import$b$foo | ./b       | foo      |

exported symbols:

| Exported | Local       |
| -------- | ----------- |
| \*       | $id$exports |

#### Packaged output

```js
let $id$exports = {};
$id$exports[something] = 2;
$id$exports.foo();
```

### Non-static require -> Non static exports

#### Input

```js
// a.js
const b = require('./b');
b[foo]();

// b.js
exports[something] = 2;
```

#### Hoist output

```js
// a.js
import 'id:./b';
$id$import$b[foo]();

// b.js
$id$exports[something] = 2;
```

imported symbols:

| Local         | Specifier | Imported |
| ------------- | --------- | -------- |
| $id$import\$b | ./b       | \*       |

exported symbols:

| Exported | Local       |
| -------- | ----------- |
| \*       | $id$exports |

output:

```js
let $id$exports = {};
$id$exports[something] = 2;
$id$exports[foo]();
```

### Wrapped require

#### Input

```js
// a.js
function test() {
  return require('./b').foo;
}

// b.js
exports.foo = 2;
```

#### Hoist output

```js
// a.js
import 'id:./b';
function test() {
  return $id$import$b$foo;
}

// b.js
let $id$export$foo = 2;
```

imported symbols:

| Local            | Specifier | Imported |
| ---------------- | --------- | -------- |
| $id$import$b$foo | ./b       | foo      |

exported symbols:

| Exported | Local           |
| -------- | --------------- |
| foo      | $id$export\$foo |

wrapped dependencies:

- `./b`

#### Packaged output

```js
atlaspackRequire.register('b', module => {
  let $id$export$foo = 2;
  $atlaspack$export(module.exports, 'foo', () => $id$export$foo);
});

function test() {
  return atlaspackRequire('b').foo;
}
```

## CommonJS patterns

### Safe patterns

These are the patterns that we are able to fully statically analyze in CommonJS modules. This means that requires can be replaced with static variable references to the imported module's exports. The exports are static, so are replaced with individual variables for each exported symbol.

#### Requires

```js
require('y');
require('y').foo;
require('y').foo();

const y = require('y');
const x = require('y').x;
const {x} = require('y');
const {x: y} = require('y');
const {x = 2} = require('y');

// Safe but needs to be split into separate declarations.
const a = sideEffect(),
  b = require('y');
```

#### Exports

```js
exports.foo = 2;
module.exports.foo = 2;
this.foo = 2;
exports['foo'] = 2;

function test() {
  exports.foo = 2;
}
```

### Non-static patterns

These patterns require a namespace object to be used instead of static references.

#### Requires

```js
require('x')[something];
const x = require('x')[something];
const x = require('x');
x[something];
const {x, ...y} = require('x');
x = require('y');
({x} = require('y'));
```

#### Exports

```js
exports[foo] = 2;
module.exports[foo] = 2;
this[foo] = 2;

sideEffect(exports);
sideEffect(module.exports);
```

### Wrap patterns

These patterns require the imported module to be wrapped to preserve side effect ordering.

#### Requires

```js
function x() {
  const x = require('y');
  // etc.
}

const x = sideEffect() + require('b');
const x = sideEffect(), require('b');
const x = sideEffect() || require('b');
const x = condition ? require('a') : require('b');

if (condition) require('a');
for (let x = require('y'); x < 5; x++) {}
// etc.
```

#### Exports

```js
// Exports re-assigned
exports.foo = 2;
exports = {};
exports.bar = 3;

({exports} = something);

// Module accessed non-statically
sideEffect(module);

// Eval
eval('exports.foo = 2');

// Top-level return
return;
```
