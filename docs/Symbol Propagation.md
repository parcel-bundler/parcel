# Symbol Propagation

The goal of symbol propagation is generating the sets of used symbol based on the symbols set on assets and dependencies (see [scopehoisting.md]).

## Two Passes

In the most basic case, the used symbols can be determined in one pass by repeatedly forwarding the imports down through reexports (always matching them to the correct reexport and potentially also renaming the symbol).

But with `export *`, there is no unique reexport to match an imcoming symbol request to:

```js
// index.js
import {a} from './other.js';

// other.js
export * from './x.js'; // Is `a` exported in this one...
export * from './y.js'; // ... or in this one?

// x.js
export const a = 1;
// y.js
export const b = 2;
```

Instead, there are two passes:

- in the first ("down") pass, the incoming used symbols are matched to the correct reexport (if there is one), or to _all_ `export *`. So after this pass, the symbol will be marked as used in too many dependencies.

- in the second ("up") pass, the set of requested symbols (from the down pass) is intersected with the set of actual exports and copied back from the outgoing dependencies to the incoming dependencies. The detection of invalid imports ("x does not export y") also happens in this step: TODO

<table>
<tr><th>After down traversal</th><th>After up traversal</th></tr>
<tr>
<td>

```js
// index.js
import {a} from './other.js'; // used down: a

// other.js, used down:
export * from './x.js'; // used down: a
export * from './y.js'; // used down: a (!)

// x.js, used down: a
export const a = 1;
// y.js, used down:
export const b = 2;
```

</td><td>

```js
// index.js
import {a} from './other.js'; // used down: a, used up: a

// other.js, used down:
export * from './x.js'; // used down: a, used up: a
export * from './y.js'; // used down: a, used up:

// x.js, used: a
export const a = 1;
// y.js, used:
export const b = 2;
```

</td>
</tr></table>

## Circular Imports/Reexports

In both cases, circular reexports also have to be considered:

```js
// index.js
import {d} from './other.js';
export {b as c} from './other.js';
export const a = 1;
console.log(d);

// other.js
export {c as d} from './index.js';
export {a as b} from './index.js';
```

The down pass performs a queue-based BFS which will continue retraversing parts of the graph if they are marked dirty:

- `dep.usedSymbolsDownDirty`: ensure that the down traversal revisits the dependency resolution (e.g. a symbol was added/removed and this should be propgated further down)

The up pass is a post-order recursive DFS. Any dependencies that are still dirty after the main traversal are then traversed again until nothing is marked dirty anymore:ODO

- `dep.usedSymbolsUpDirtyUp`: TODO
- `dep.usedSymbolsUpDirtyDown`: TODO

## Down Traversal

1. Categorize incoming usedSymbols into `asset.usedSymbols` or the `namespaceReexportedSymbols` (so `asset.usedSymbols` now also contains reexports, they will be removed again in the next step)
2. If the asset no sideffects and also nothing is requested by the incoming dependencies, then the entire subgraph is unused. Otherwise the `namespaceReexportedSymbols` are redistributed to the `export *` dependencies, and the contents of `asset.usedSymbols` are forwarded to individual dependencies where possible.

If some outgoing dependency was changed by these steps, it's marked as dirty:

- `dep.usedSymbolsDownDirty = true` so that the dependency resolution will be revisited later in this traversal
- `dep.usedSymbolsUpDirtyDown = true` TODO

## Up Traversal

TODO

[scopehoisting.md]: Scopehoisting.md
