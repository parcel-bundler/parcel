## `bundle()`

During the bundling phase, we hand over control to the bundler plugin via `bundle()`. This mutative function is called in the `BundleGraphRequest`, and is passed in a stripped version of the AssetGraph, called the `mutableBundleGraph`. Users can specify custom bundler plugins in their `.parcelrc`. In this document we will go through the default bundler plugin.

```
await bundler.bundle({
          bundleGraph: mutableBundleGraph,
          config: this.configs.get(plugin.name)?.result,
          options: this.pluginOptions,
          logger,
          tracer,
        });
```

# Default Bundler Plugin

The goal of the bundler is to mutate the Assetgraph into a BundleGraph by adding bundles and edges. The DefaultBundler can be divided into two main parts, `CreateIdealGraph` and `decorate()`.

In order write the bundling algorithm in distinct, disjoint steps, we defer mutating the AssetGraph to a step called `decorate()`. The bulk of the algorithm is executed on a localized, smaller _IdealGraph_ that only represents bundles, and a few other supplementary structures ultimately passed to decorate as an `IdealGraph` object, containing our local representation of the bundleGraph.

```
  type IdealGraph = {|
    assets: Array<Asset>,
    dependencyBundleGraph: DependencyBundleGraph,
    bundleGraph: Graph<Bundle | 'root'>,
    bundleGroupBundleIds: Set<NodeId>,
    assetReference: DefaultMap<Asset, Array<[Dependency, Bundle]>>,
    manualAssetToBundle: Map<Asset, NodeId>,
  |};
```

Note: Within `createIdealGraph()`, the local IdealGraph is refered to simply as the bundleGraph, while the `mutableBundleGraph` passed in, is referred to as assetGraph. This is because we don't actually add bundles to the `mutableBundleGraph` until decorate. Until that point it is just as assetgraph.

## Definitions

- **Asset:** A file or representation of a file with some information about how it should be bundled

- **Bundle:** A grouping of assets which are loaded together and within the same location

- **BundleGroup:** Group of bundles which will load together, which has an entry bundle (the first bundle to load out of the group)

  - _Note the existence of LegacyBundle which refers to the old Bundle structure_

- **AssetGraph:** A Graph representing Assets and their Dependencies as they appear in a user’s project

- **BundleGraph:** A Graph maintaining Bundles, Assets, Dependencies, and Entries as Nodes, with relationships as edge types

- **local BundleGraph:** Within `CreateIdealGraph()`, we maintain a local BundleGraph which represents only bundles that load in parallel, represeted by being attached to the root dummy node.

- **Default:** The Default BundleGraph (which you will most commonly see throughout Parcel) maintains the nodes mentioned above and is a modified version of the AssetGraph.

- **IdealGraph:** Structure which contains the local bundleGraph, dependencyBundleGraph, BundleGroupIds, and a mapping of asset references. This stores all info needed to back-port our structures to the “standard” bundleGraph

- **dependencyBundleGraph:** Maps bundles to their dependencies

- **bundleRoots:** An Asset which is an entry to a Bundle

- **reachableBundles:** A graph maintaining Synchronous relationships between bundleRoots

- **BundleRootGraph:** A graph maintaining Async and Parallel relationships between bundleRoots

- **Entries**

  - **Entry to Project:** A file the user points Parcel at, in the bundler, this is a set of assets

  - **Entry to A Bundle:** The main or first asset in a bundle

  - **Entry to A BundleGroup:** The main or first bundle in a bundleGroup, which triggers the bundleGroup to be loaded

- assetReference: For bundles within the same bundleGroup as their parent, reference edges are drawn between bundles and dependencies

## Step: Create Entries

Create bundles for each entry the user as specified to the project. Entries can be specified in the build command.

## Step: Create Bundles for explicit code split points

Create bundles for explicit code split points. These are…

- Asynchronous: this bundle does not need to load automatically

- Isolated: Cannot share any assets with other bundles

  - Example: A URL import import url from 'url:./resource.txt';

  - A key difference between bundlers here is that we’ve implicitly created a relationship of one asset to one bundle, and so if a dependency is isolated for example, then we mark that bundle isolated for all purposes. This means it cannot share any assets with other bundles.

- A type change: If the parent asset is a different type than the child.

- Parallel: Separate bundle but loaded with the parent.

- Inline: Separate bundle, which is placed into the parent bundle before writing to dist

  - SVG image inlined into html: `<img src="data-url:./img.svg"/>`

More on code splitting: [Code Splitting](https://parceljs.org/features/code-splitting/).

We also maintain the notion of bundleGroups during this traversal. Entry bundles and Async Bundles are also bundleGroups.

Here’s an example of how some files are translated to a bundleGraph.

<table><tr>
<td>

```js
//index.js
import('./foo'); //async imports
import('./bar');
```

</td><td>

```js
//bar.js
import styles from './styles.css';
import html from './local.html'; //isolated
```

<td>
</tr></table>

// TODO IMAGE
IdealBundleGraph from integration/shared-bundle-single-source/index.js

## Step: Merge Type Change Bundles

Type change bundles are a special case of bundle, because they require consistent or “stable” names. As a result, we only allow one bundle of another type per bundleGroup. So, we need to merge bundles that exist within the same bundleGroups. (i.e. siblings)

See example #1 for an example of when we merge type change bundles.

## Step: Determine Reachability

Here is where we begin building up the graphs required to determine where to place assets. The first is called reachableRoots. ReachableRoots maintains all bundleRoots and what assets are available to them synchronously.

## Step: Determine Availability

Now, in order to know where to place assets, we construct a mapping of all assets available to a bundleRoot (or bundle). This is called ancestorAssets and it is populated with assets available via older siblings, assets within the same bundleGroup, and parent and ancestor bundles.

At each bundleRoot, we first determine the assets that would be available via bundleGroup, since the bundles in a bundleGroup are loaded together. This is the bundles in the bundleGroup (BundleRoot Assets + Synchronously available Assets)

Next, we “peek ahead” to the children, and propagate the available assets down, intersecting as we go since that will be the set of assets available by any “path”.

In the case of sibling parallel dependencies, the younger siblings have access to the assets of the older siblings, since they load in order, so we must propagate those too. This ensures we can extract shared code between siblings

## Step: Internalize Async Bundles

Internalization is when some asset requires an asset synchronously, but also asynchronously. This is redundant so we don’t need to load the extra (async) bundle. We mark this in `bundle.internalizedAssetIds`, and an internalized asset is ultimately displayed as an orange edge.

## Step: Insert or Share

Here, we place assets into bundles since they require them synchronously, or by other means (like entries need all their assets within their bundle). If an asset is “reachable” from many bundles, we can extract it into a shared bundle.

You may think of reachable as all the bundles that still need an asset by some means. We filter it down to ensure we only place assets where they need to be. Any bundle that contains the asset in question in it’s ancestorAssets is filtered out, & entries are filtered out.

### Reused Bundles

    There’s a special case here that is unique to the experimental bundler, which is reusing bundles. We noticed sometimes, if two or more bundles shared the whole contents of another bundle, reusing that bundle is as simple as drawing an edge, as opposed to creating a shared bundle that would essentially be a copy of another. In the above example, foo.js is a reused bundle. You can tell a bundle is reused if it has both an entry asset and source bundles.

### Other special cases

- Manual shared bundles: See []

## Step: Merge Shared Bundles

Users of Parcel can specify a bundler config, which sets minbundleSize, maxParallelRequests, and minBundles. In this step we merge back and shared bundles that are smaller than minBundleSize.

This config option only affect shared bundles.

## Step: Remove Shared Bundles

Finally, we remove shared bundles to abide by maxParallelRequests. maxParallelRequests semantically affects how many bundles are to be loaded at once, and syntactically affects how many bundles can be in a bundle group.

One difference between the default and experimental bundler is here, where we also merge back “reused” bundles. Unlike shared bundles, reused bundles may have children, so we must update the graph accordingly. Below is an example graph from shared-bundle-reused-bundle-remove-reuse/index.js

# BundleGraph Decoratation

BundleGraph decoration takes ideal graph and mutates the passed-in assetGraph aka Mutable bundleGraph, in order to back port our idealGraph to what Parcel expects.
