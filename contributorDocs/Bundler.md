# Bundler.md

## Experimental Bundler Contributing Docs

From here on I will refer to the Experimental Bundler simply as "The Bundler", and the Default Bundler as "Old Bundler" or "Previous Bundler".

The Bundler works by creating an ideal graph which models bundles, connected to other bundles by what references it, and thus models BundleGroups. This graph is called the BundleGraph.

In addition to the BundleGraph, we build up structures to inform the decoration of the old BundleGraph. We will go over these structures as we go through the algorithm.

First, we enter `bundle({bundleGraph, config})`. Here, "bundleGraph" is actually just the assetGraph turned into a type `MutableBundleGraph`, which will then be mutated in decorate, and turned into what we expect the bundleGraph to be as per the old (default) bundler structure & what the rest of Parcel expects a BundleGraph to be.

`bundle({bundleGraph, config})` First gets a Mapping of target to entries, In most cases there is only one target, and one or more entries. (Targets are pertinent in monorepos or projects where you will have two or more distDirs, or output folders.) Then calls create IdealGraph and Decorate per target.

IdealGraphCreation has a few loops over the assetGraph (MutableBundleGraph)

## Bundle Creation

Create Bundles for entries, then traverse the AssetGraph (aka MutableBundleGraph) and create bundles for async imports, type changes, and add edges for those bundles.

## Merging of Types

Merge Bundles that belong to the same exact bundleGroups, of the same type, unless dependency specifies not to.

## Determine Reachability

To determine what assets go where, without unnecessary duplication and an ideal amount of shared bundles, we first built two structures,

one traversal each. `ReachableRoots` to store `sync` relationships, and `ancestorAssets` to store the minimal availability through `parallel` and `async` relationships.

We Build AncestorAssets with a peek ahead strategy. We visit nodes from the bundleRootGraph that have been topologically sorted. At a BundleRoot, we access it's available assets (via ancestorAssets), and add to that all assets within the bundles in that BundleGroup. This set is available to all bundles in a particular bundleGroup because bundleGroups are just bundles loaded at the same time. However it is not true that a bundle's available assets = all assets of all the bundleGroups it belongs to. It's the intersection of those sets.

Now that we have bundleGroup availability, we will propagate that down to all the children of this bundleGroup. For a child, we also must maintain parallel availability. If it has parallel siblings that come before it, those, too, are available to it. Add those parallel available assets to the set of available assets for this child as well.

Most of the time, a child will have many parent bundleGroups, so the next time we peek at a child from another parent, we will intersect the availability built there with the previously computed availability. this ensures no matter which bundleGroup loads a particular bundle, it will only assume availability of assets it has under any circumstance.

**ReachableRoots** is a Graph of Asset Nodes which represents a BundleRoot, to all assets (non-bundleroot assets) available to it synchronously (directly) built by traversing the assetgraph once.

**AncestorAssets** is a Map that tracks a bundleRoot, to all assets available to it (meaning they will exist guaranteed when the bundleRoot is loaded)

This map is built up by a topological sorting of the bundleRootGraph (technically just the asset graph minus sync deps). The topological sort ensures all parents are visited before the node we want to process.

TODO: replace these structures with one graph with many edge types.

## Internalize Async Bundles

Next, internalize Async bundles if and only if, the bundle is synchronously available elsewhere. (Does this mean parallel bundles could also be internalized ?). We can query sync assets available via reachableRoots. If the parent has the bundleRoot by reachableRoots AND ancestorAssets, internalize it.

## Insert non BundleRoot Assets or create shared bundles

Now, we take assets, and reduce what is reachable from them. Filter out entries, since they can't have shared bundles. Neither can non-splittable, isolated, or needing of stable name bundles. Reserve those bundles since we add the asset back into them.

The remaining reachable bundleRoots, are then filtered by if the asset is not in their ancestry (meaning it's actually not reachable from the bundleRoot).

Finally, filter out bundleRoots (bundles) from this assets reachable if they are subgraphs, **and** reuse that subgraph bundle by drawing an edge. Essentially, if two bundles within an assets reachable array, have an ancestor-subgraph relationship, draw that edge.

## Merge sharedBundles

Go through the sharedBundles and delete any that hit the limits

# Structure Definitions

**BundleGraph**: A Graph of Bundles and a root node (dummy string), which models only Bundles, and connections to their referencing Bundle

**ReferencingBundle**: The Bundle that first brings in another bundle (essentially the FIRST parent of a bundle, this may or may not be a bundleGroup)

**BundleGroup**: A Bundle that marks the start of a group of bundles which must be loaded together. There are no actual BundleGroup nodes, just bundles that take on that role.

**BundleRoot**: An asset that is the main entry of a Bundle.

**BundleRootGraph**: A ContentGraph which models BundleRoots (aka Assets), and only the relationships between them (async or parallel). This (along with reachable roots) informs reachability.

**ReachableRoots**: A ContentGraph which models BundleRoots and what is reachable from them, including non-bundleRoot assets as well as other BundleRoots.

**AncestorAssets**: A mapping of BundleRoots to ALL assets reachable from it (This means all the assets reachable from it's ancestors (sync, async, parallel), PLUS any sync assets available to itself via bundleGroup or self, PLUS any parallel siblings that are guaranteed to load before it)

# Other Definitions, as they relate to the bundler

**Isolated** : An isolated Dependency, or Bundle must contain all assets it needs to load.

**URL Specifier Type** : Cannot be merged or internalized.

# TODO

- Refine doc, annotate code
- Separate out technical docs
