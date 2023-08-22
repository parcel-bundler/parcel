# Symbols and Scope Hoisting

## Concepts

### Tree Shaking and Scope Hoisting

Tree shaking refers to the general principle of removing dead code. With a naive browserify-style bundling (= what Parcel does in development builds), exports that are never used in the project are still "used" in a syntactical sense (= not dead), but not in a runtime code coverage sense (= unused).

Some ways to improve this are:

- Determine which exports are used, and drop the `export` statement during the build. Then the exported value becomes an unused variable and a minifier can remove it. This is what symbol propagation and the conditional generation of only used `$parcel$export()` calls achieves.
  This is also why `/*#__PURE__*/` comments are important:

```js
function Button() {...}
$parcelRequire(exports, "Button"; () => Button); // was: export { Button };

// The export was removed during the build, and the function will be dropped by the minifier:
function Select() {...}
// export {Select};

// Without the pure comment, minifiers wouldn't be able to remove the right hand side.
// (Note: Babel/swc add this comment automatically when transpiling JSX)
const MyContext = /*#__PURE__*/ React.createContext();
// export {MyContext};
```

- Determining used exports covers almost all tree shaking needs, but it would still leave the module registry ("prelude").

  By concatenating assets into a single scope, the function calls for `parcelRequire("id").foo` can be replaced with a regular variable access `$id$export$foo` (ESM import are live bindings, so accessing an imported value in a function would perform this function call every single time, though it's just an object lookup anyway). And these `parcelRequire.register(() => {...})` wrappers plus `parcelRequire` calls also have some bundle size overhead.

  It can also improve the effectiveness of the minifier, especially regarding function inlining and constant evaluation, but this really depends on the actual code.

<table><tr>
<td>

```js
// math.js
export function add(a, b) {
  return a + b;
}

export function square(a) {
  return a * a;
}

// index.js
import {add} from './math';
console.log(add(2, 3));
```

</td><td>

```js
function $fa6943ce8a6b29$export$add(a, b) {
  return a + b;
}

// dead code
function $fa6943ce8a6b29$export$square(a) {
  return a * a;
}

console.log($fa6943ce8a6b29$export$add(2, 3));
```

</td>
</tr></table>

### Skipping assets (deferring and skipping during bundling)

(An asset or a dependency being unused means `getUsedSymbols(asset or dep).size === 0`).

There are two ways in which assets can be skipped (not included in the output):

**Subgraph**: if a reexport is unused, then the whole subgraph of that dependency can be ignored. This system is built into core because this should be safe in any case.

- _Deferring_: This can happen during the graph visit when building the asset graph. There is effectively a one-reexports-level lookahead, so if an reexports some symbol `x` and no incoming dependency requests `x`, then the reexport (and the corresponding dependency) is skipped. This doesn't work for `export *`.

  Another benefit of deferring is that deferred assets don't get transformed in the first place. So something like `import {Button} from "design-system";` would only process that single `export {Button} from "./button";` and completely ignore all other exports in `design-system/index.js`.

  Deferring can also happen without scopehoisting (as the non-scopehoisting JS transformer also sets symbols).

- _Unused dependency_: This is the same principle as deferring, but for an unlimited reexport depth and also for `export *`. Instead of checking the incoming dependencies and matching with non-star reexports, `bundleGraph.getUsedSymbols(dep).size === 0` is used (this information comes from symbol propagation).

  Symbol propagation currently only runs when scope hoisting is enabled.

**Single Asset**: if a side-effect free asset only has reexports and doesn't export a value itself (and is also not imported from other bundles), then it can be skipped since the reexports will be resolved to their original assets anyway. This is handled in the JS packager only, and not in core.

```js
import {a} from './lib.js';
console.log(a);

// lib.js, asset gets skipped
export * from './exports-a.js'; // dep used, not skipped
export * from './exports-b.js'; // dep skipped with symbol propagation
export {c} from './exports-c.js'; // dep skipped with deferring
```

### Symbols

Both assets and dependencies have attached symbol information. These are maps that describe what an asset (re)exports, and what a dependency imports/reexports.

Core (so symbol propagation and `getSymbolResolution`) rely on the following convention (plugins can store custom information in the per-symbol meta properties):

- `asset.symbols` is a map of export names (= what the export was called in the source) to the local names (whatever Parcel renamed the variable to, e.g. `$id$export$foo`). `*` represents the namespace object and is only set for CJS assets (which makes `getSymbolResolution` fall back to a property access).

- `dependency.symbols` is a map of import names (= which binding was imported) to the local name (= the identifier that the imported binding got replaced by, e.g. `$id$import$bar`). The whole namespace can be imported by using `*` as the import name. A dependency with a `* -> *` mapping corresponds to `export * from`.

All CommonJS assets have a `* -> $id$exports` symbol, which serves as a fallback when importing a symbol that is not explicitly listed. This is also what prevents symbol propagation from throwing a `some-commonjs.js does not export foo` error, as this can't be done reliably for CommonJS assets (e.g. assets can be added from outside the asset).

`module.exports = ...;` or some other non-statically analyzable syntax like accessing `module` freely causes the asset to have a `*`.

These two types of mapping can be used together to model reexports:

- `export {a as b} from "x";` is turned into a `a -> $id$import$x$a` mapping on the dependency and a `b -> $id$import$x$a` mapping on the asset.
- `export * as a from "x";` is turned into a `* -> $id$import$x` mapping on the dependency and a `a -> $id$import$x` mapping on the asset.
- (`export *` just have that `* -> *` on the dependency)

Examples:

<table>
<tr><td>

```js
export const foo = 2;
```

</td><td>

```
asset.symbols = {
  foo -> $assetId$export$a829fe
}
```

</td></tr>
<tr><td>

```js
import {foo} from './other.js';
```

</td><td>

```
dependencies["./other.js"].symbols = {
  foo -> $assetId$import$8128f$281fa (isWeak: false)
}
```

</td></tr>
<tr><td>

```js
export {foo as bar} from './other.js';
```

</td><td>

```
asset.symbols = {
  bar -> $assetId$import$8128f$281fa
}
dependencies["./other.js"].symbols = {
  foo -> $assetId$import$8128f$281fa (isWeak: true)
}
```

</td></tr>
<tr><td>

```js
export * from './other.js';
```

</td><td>

```
asset.symbols = {}
dependencies["./other.js"].symbols = {
  * -> * (isWeak: true)
}
```

</td></tr>
</table>

#### Used Symbols

The used symbols are determined by symbol propagation, and have slightly different meanings for dependencies and assets:

- `getUsedSymbols(asset)` is the set of symbols that were resolved to this specific asset (so excluding eventual reexports).
- `getUsedSymbols(dependency)` is the set of symbols that are imported through the dependency (so both including reexports). So for an `export {a, b} from "...";` it is a subset of `a,b` and for `export * from "...";` it is the set of symbols that are actually resolved through that reexport.

### Integrating ESM and CJS with parcelRequire: Circular Imports and Conditional Requires

#### ESM

The ES module system behaves exactly like assets getting concatenated and imports getting resolved to their actual bindings.

```js
// index.js
import {func} from './other.js';
func(); // ReferenceError: Cannot access 'value' before initialization
export const value = 1;

// other.js
import {value} from './index.js';
export function func() {
  return value + 1;
}
```

If `value` were instead a function, calling it would work correctly (functions are still hoisted). So circular imports are why `$parcel$export` calls also have to be hoisted to the top of the asset.

#### Limitations

The reasons why the `parcelRequire` registry is needed are assets being accessed from other bundles (and potentially being duplicated), and conditional requires (which are impossible with pure ESM declarations).

So assets that have at least one conditional incoming dependency or are used by some other bundle, are wrapped in a `parcelRequire.register`. `require("foo")` calls inside ifs or functions are replaced with the appropriate `parcelRequire("id")` call.

But since the whole subgraph is conditionally executed, all assets have to be wrapped and inside of that subgraph, imports cannot be replaced with the top level variables anymore, but instead get replaced with the CommonJS equivalent (so `var $id = parcelRequire("id");` and then `$id.foo`) which also runs the side effects.

### Runtime Deduplication

One part of scope hoisting is getting rid of the registry that is used in development/browserify, but the registry is unfortunately still needed whenever an asset is included in multiple bundles. This ensures that an asset is only ever evaluated at most once, so that side-effects don't run twice, and that the identity of the exports is retained:

```js
// index.js
const a = await import("./async1.js");
const b = await import("./async2.js");
console.log(a.constructor === b.constructor) // or using `instanceof`, ...

// async1.js (becomes an async bundle together with a copy of "lib")
import {SomeClass} from 'lib';
export default new SomeClass();

// async2.js (becomes an async bundle together with a copy of "lib")
import {SomeClass} from 'lib';
export default new SomeClass();
```

### Interop

The usual way for importing CommonJS using synchronous ESM imports is via an default export, which then contains the exports namespace object of the CommonJS asset.

```js
import v from './other';
// v == { x: 2, y: 3 }

// other.js
module.exports.x = 2;
module.exports.y = 3;
```

But by convention (with Babel, tsc, ...), this should not happen if the imported asset is actually an ESM file that was transpiled to CommonJS beforehand (and e.g. published to npm). In that case, the default import should refer to original default export (which was transpiled to `exports.default = ...;`). Without interop, the default export would be `{ default: ... }`.

So instead, transpilers add an additional "export" with `exports.__esModule = true;` which declares a file to be ESM-transpiled-to-CommonJS.

An asset with a default import of a (maybe)-CommonJS file now needs to do a lookup:

```js
function interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : {default: obj};
}
var _x = interopRequireDefault(require('./x'));
```

With scope hoisting, Parcel can omit this call in many cases when the importee was determined to be ESM or ESM-transpiled-to-CommonJS via static analysis.
