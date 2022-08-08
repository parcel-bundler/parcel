# Scopehoisting Packager - Overview

The skipping of assets is described as "single asset skipping" in [Scopehoisting.md].

## Starting point `package()`:

1. `loadAssets()`: Load the assets contents from cache and determine which assets are wrapped.
2. `processAsset()/visitAsset()` which call `buildAsset()`: These will recursively resolve dependency specifiers and inline dependencies.
3. Start the process by calling `processAsset()` for all assets (and skip to process assets only once if it was already inlined somewhere else).

## `buildAsset()`:

1. If the asset should be skipped: ignore the current asset, recurse over dependency assets and concatenate them together
2. `buildReplacements()` for the mappings used during the text replacement
   - The dependency map which is used to resolve `import "...";` declarations inserted by the transformer: `${assetId}:${specifier}${specifiertype} -> Dependency`
   - Import replacements: the local part of a dependency symbol (`$id$import$foo`) -> result of getSymbolResolution (e.g. `$id$export$bar` or `parcelRequire("id").bar`)
3. `buildAssetPrelude()`:
   - generates `$parcel$defineInteropFlag` call if needed
   - synthesises exports object for asset if needed (including generation of the `$parcel$export` and `$parcel$exportWildcard` calls for used re/exports)
4. Perform the replacements with `REPLACEMENT_RE` matching one of
   - `import "id";`
        - will be replaced with the source code of the asset (`buildAsset` recursive call). If the referenced asset is wrapped, don't inline but place it after the current asset (into `depContent`).
     - calls `getHoistedParcelRequires` to read the `hoistedRequires` list from `getSymbolResolution` and prepend needed requires (see [Scopehoisting.md])
   - `$id$exports`
     - will be looked up in the replacements
     - TODO WHY?
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
