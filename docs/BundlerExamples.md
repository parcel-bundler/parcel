## Targets

To configure multiple targets, a user can specify them in their `package.json`

```json5
"targets": {
    "main1": {
      "distDir": "./dist/main1",
      "source": "./src/main1/index.html",
      "publicUrl": "./"
    },
    "main2": {
      "distDir": "./dist/main2",
      "source": "./src/main2/index.html",
      "publicUrl": "./"
    }
  },
```

This will then be interpreted from the `AssetGraph` into a map of targets, which contains the target as the key, and the value a map of entries to the dependencies with matching targets.

```
[Target Map] {
  '/dist/main1' => Map(1) {
    Asset(/main1/index.html) => Dependency(null -> src/main1/index.html)
  },
  'dist/main2' => Map(1) {
    Asset(/main2/index.html) => Dependency(null -> src/main2/index.html)
  }
```

`bundle()` is then called for **each** entry in the Map, creating two distict `IdealGraphs`, and in this case, identical graphs. `createIdealGraph` skips any subtrees of another target.

```js
if (!entries.has(node.value)) {
  actions.skipChildren();
}
```

The sample file tree below represents the output created by the final `bundleGraph`

```
> dist
    > main1
        index.html
        index.a05w6.js
        shared.123.js
    > main2
        index.html
        index.b80d3.js
        shared.123.js
```

_The full test case can be found in the `supports multiple dist targets` case in `html.js` integration test file._

## Two CSS imports

Here we'll go through what occurs in an example where two entries to a project import different css files.

Given one `js` entry, an async `js` import, and two `css` imports, we generate the following Assetgraph.
![image info](./BundlerGraphs/css-merging/AssetGraph-css-merging.png)

Below is the local bundleGraph generated after **Step Create Bundles**. **Node 1** is generated in the first step because it is specified as an entry to the project.

![image info](./BundlerGraphs/css-merging/bundleGraph-premerge.png)

After **Step Create Bundles**, we have generated a bundle per entry, code-split points, and type-change bundles.

```
foo.css bundle -> BundleGroups [entry.js, index.js]
main.css bundle -> BundleGroups [entry.js]
```

In order to maintain the constraint of one bundle of a different type per bundlegroup, we need to merge bundles together. However, merging `foo.css` and `main.css` will result in `index.js` over-fetching `main.css`

In order to maintain correctness, we may need to duplicate assets, and end up with the final `idealGraph` below.

![image info](./BundlerGraphs/css-merging/bundlegraph-postmerge.png)

_The full test case can be found in the `multi-css-multi-entry-bug/src/` integration test._

## Internalized Asynchronous Asset

In this scenario, reachable is x

## Siblings Script Tags in HTML (aka Parallel Siblings Availabilty)

## Reused Bundle

Reused bundles are a special type of shared bundle. When bundling files below

_The full test case can be found in the `should reuse a bundle` case in `javascript.js` integration test file._
