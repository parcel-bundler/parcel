# Default Bundler

The bundling phase can be divided into two main parts, create and decorate. CreateIdealGraph is the bulk of the algorithm and decorate simply back-ports our "Ideal Graph" structures to our previous BundleGraph structure. The main differences between these two graphs are that the Ideal graph does not contain any BundleGroup, Dependency, or Asset nodes. It only depicts bundles loaded in parallel, and the bundle’s which reference them.

In both instances of the Bundler, the BundleGraph is a stripped version of the AssetGraph, and has nodes mutated/ added on in bundling.

## Definitions

```
- Asset: A file or representation of a file with some information about how it should be bundled

- Bundle: A grouping of assets which are loaded together and within the same location

- BundleGroup: Group of bundles which will load together, which has an entry bundle (the first bundle to load out of the group)

- Note the existence of LegacyBundle which refers to the old Bundle structure

- AssetGraph: A Graph representing Assets and their Dependencies as they appear in a user’s project

- BundleGraph: A Graph maintaining Bundles, Assets, Dependencies, and Entries as Nodes, with relationships as edge types

- Experimental: Within the Experimental Bundler, the BundleGraph represents only bundles that load in parallel, meaning they are attached to the root.

- Default: The Default BundleGraph (which you will most commonly see throughout Parcel) maintains the nodes mentioned above and is a modified version of the AssetGraph.

- IdealGraph: Structure which contains the Experimental BundleGraph, dependencyBundleGraph, BundleGroupIds, and a mapping of asset references. This stores all info needed to back-port our structures to the “standard” bundleGraph

- dependencyBundleGraph: Maps bundles to their dependencies

- bundleRoots: An Asset which is an entry to a Bundle

- reachableBundles: A graph maintaining Synchronous relationships between bundleRoots

- BundleRootGraph: A graph maintaining Async and Parallel relationships between bundleRoots

- Entries

- Entry to Project: A file the user points Parcel at, in the bundler, this is a set of assets

- Entry to A Bundle: The main or first asset in a bundle

- Entry to A BundleGroup: The main or first bundle in a bundleGroup, which triggers the bundleGroup to be loaded

- assetReference: For bundles within the same bundleGroup as their parent, reference edges are drawn between bundles and dependencies


```

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

More on code splitting: [Code Splitting ](https://parceljs.org/features/code-splitting/).

We also maintain the notion of bundleGroups during this traversal. Entry bundles and Async Bundles are also bundleGroups.

Here’s an example of how some files are translated to a bundleGraph in the experimental bundler.

//index.js
import('./foo'); //async imports
import('./bar');

//bar.js
import styles from './styles.css';
import html from './local.html'; //isolated

IdealBundleGraph from integration/shared-bundle-single-source/index.js

## Step: Merge Type Change Bundles

## Step: Determine Reachability

## Step: Determine Availability

## Step: Internalize Async Bundles

## Step: Insert or Share

## Step: Merge Shared Bundles

## Step: Remove Shared Bundles

# BundleGraph Decoratation

Code : `hasDeferred=true`

code inline :

```mermaid
Hello this is the code
```
