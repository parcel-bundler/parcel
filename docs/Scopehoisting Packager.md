# Scopehoisting Packager - Overview

(The skipping of single assets is described in [Scopehoisting.md]).

## Starting point `package()`:

1. `loadAssets()`: Load the assets contents from cache and determine which assets are wrapped.
2. `processAsset()`/`visitAsset()` which call `buildAsset()`: These will recursively resolve dependency specifiers and inline dependencies, and append the result to the toplevel `res` string.
3. Kick off the process by calling `processAsset()` for all assets (and skip some to only process assets once if it was already inlined somewhere else).

## `buildAsset()`:

1. If the asset should be skipped: ignore the current asset, call `buildAsset()` for dependency assets and concatenate only them together.
2. Call `buildReplacements()`, generating the `Map`s used during the text replacement:
   - The dependency map which is used to resolve `import "...";` declarations inserted by the transformer: `${assetId}:${specifier}${specifiertype} -> Dependency`
   - Import replacements: the local part of a dependency symbol (`$id$import$foo`) -> result of `getSymbolResolution` (e.g. `$id$export$bar` or `parcelRequire("id").bar`)
3. Call `buildAssetPrelude()`:
   - generates `$parcel$defineInteropFlag($id$exports)` call for this asset if needed.
   - synthesises the exports object if needed (including generation of the `$parcel$export` and `$parcel$exportWildcard` calls only for used re/exports)
4. Perform the replacements with `REPLACEMENT_RE` matching one of
   - `import "id";`
     - will be replaced with the source code of the asset (call `buildAsset()` recursively ). If the referenced asset is wrapped, don't inline but place it after the current asset (into `depContent`).
     - calls `getHoistedParcelRequires` to read the `hoistedRequires` list from `getSymbolResolution` and prepend needed requires (see [Scopehoisting.md])
   - `$id$exports`
     - `module.exports` inside the asset gets replaced with `$id$exports` in the transformer, but for wrapped assets, this has to be replaced back to `module.exports`
   - `$id$import|importAsync|require$foo`
     - will be looked up in the replacements and replaced with the resolved identifier
5. If necessary, wrap the result up until now with `parcelRequire.register("id", ...)`.

## `getSymbolResolution()`:

- is a wrapper around `bundleGraph.getSymbolResolution()`
- returns the resolved expression for the specified symbol
  - `$id$export$bar` (e.g. same-bundle ESM import),
  - `$id$exports` (e.g. same-bundle ESM import),
  - `id$exports.bar` (e.g. non statically analyzable exports) or
  - `parcelRequire("id").bar` (wrapped/in another bundle)
  - `$parcel$interopDefault` (if an ESM default import resolved to a non-statically analzable CJS asset)
- also handles interop (if the default symbol is imported and the resolved asset is CJS, use the namespace instead)
- tracks imports of wrapped assets (which will need `parcelRequire` call) by mutating the `hoistedRequires` list

[scopehoisting.md]: Scopehoisting.md
