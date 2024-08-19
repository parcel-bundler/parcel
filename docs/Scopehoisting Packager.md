# Scopehoisting Packager - Overview

(The skipping of single assets is described in [Scopehoisting](Scopehoisting.md)).

## Starting point `package()`:

1. `loadAssets()`: Load the assets contents from cache and determine which assets are wrapped.
2. `processAsset()`/`visitAsset()` which call `buildAsset()`: These will recursively resolve dependency specifiers and inline dependencies, and append the result to the top level `res` string.
3. Kick off the process by calling `processAsset()` for all assets (and skip some to only process assets once if it was already inlined somewhere else).

## `buildAsset()`:

1. If the asset should be skipped: ignore the current asset, call `buildAsset()` for dependency assets and concatenate only them together.
2. Call `buildReplacements()`, generating the `Map`s used during the text replacement:
   - The dependency map which is used to resolve `import "...";` declarations inserted by the transformer: `${assetId}:${specifier}${specifiertype} -> Dependency`
   - Import replacements: the local part of a dependency symbol (`$id$import$foo`) -> result of `getSymbolResolution` (e.g. `$id$export$bar` or `atlaspackRequire("id").bar`)
3. Call `buildAssetPrelude()`:
   - generates `$atlaspack$defineInteropFlag($id$exports)` call for this asset if needed.
   - synthesizes the exports object if needed (including generation of the `$atlaspack$export` and `$atlaspack$exportWildcard` calls only for used re/exports)
4. Perform the replacements with `REPLACEMENT_RE` matching one of
   - `import "id";`
     - will be replaced with the source code of the asset (call `buildAsset()` recursively ). If the referenced asset is wrapped, don't inline but place it after the current asset (into `depContent`).
     - calls `getHoistedAtlaspackRequires` to read the `hoistedRequires` list from `getSymbolResolution` and prepend needed requires.
   - `$id$exports`
     - `module.exports` inside the asset gets replaced with `$id$exports` in the transformer, but for wrapped assets, this has to be replaced back to `module.exports`
   - `$id$import|importAsync|require$foo`
     - will be looked up in the replacements and replaced with the resolved identifier
5. If necessary, wrap the result up until now with `atlaspackRequire.register("id", ...)`.

## `getSymbolResolution()`:

This is a wrapper around `bundleGraph.getSymbolResolution()`.

The additional dependency argument is used to determine whether CJS interop has to be applied (if it's a ESM import), or whether it's a non-conditional import (and a hoisted `atlaspackRequire` call has to be generated).

Compared to the bundle graph's method, the `parentAsset` is used to make wrapped assets using their own namespace object refer to `module.exports` instead of `$id$exports`.

- It returns the resolved expression for the specified symbol:
  - `$id$export$bar` (e.g. same-bundle ESM import),
  - `$id$exports` (e.g. same-bundle ESM import),
  - `id$exports.bar` (e.g. non statically analyzable exports) or
  - `atlaspackRequire("id").bar` (wrapped/in another bundle)
  - `$atlaspack$interopDefault` (if an ESM default import resolved to a non-statically analyzable CJS asset)
- also handles interop (if the default symbol is imported and the resolved asset is CJS, use the namespace instead)
- tracks imports of wrapped assets (which will need `atlaspackRequire` call) by mutating the `hoistedRequires` list

## `bundleGraph.getSymbolResolution()`

This method transitively/recursively traverses the reexports of the asset to find the specified export. This enables resolving some import to the actual value and not just some reexporting binding.

The result is an `asset`, the `exportSymbol` string, and `symbol`. The value can be accessed from `$asset.id$exports[exportSymbol]`, which is potentially also already (or only) available via the top-level variable `symbol`. So for the add/square example above, `getSymbolResolution(math.js, "add")` would return `{asset: "math.js", exportSymbol: "add", symbol: "$fa6943ce8a6b29$export$add"}`.

While this improves code size, an imperfection with this system is that it actually means that an asset A can use a value from asset B (which is usually modelled with a dependency from A to B) without there actually being a dependency between the two. Dependencies are also used to determine if an asset is required from another bundle and has to therefore be registered with `atlaspackRequiree`. This discrepancy can be handled inside of a single bundle, but not across multiple bundles, so the `boundary` parameter makes the resolution stop once the bundle is left.

There are three possible resolution results:

- the export has been found (with top level variable `symbol`).
- the export has not been found (`symbol === undefined`), this should have been caught already by symbol propagation
- the export has been found and is unused (`symbol === false`)
- it had to bailout because there are multiple possibilities (`symbol === null`), and the caller should fallback to `$resolvedAsset$exports[exportsSymbol]`. Some examples for bailouts are:

  - `export * from "./nonstatic-cjs1.js"; export * from "./nonstatic-cjs1.js";`, so the decision between which reexport to follow should happen at runtime.
  - if the `resolvedAsset` is a non-static cjs asset itself, then `module.exports[exportsSymbol]` should be used anyway.
