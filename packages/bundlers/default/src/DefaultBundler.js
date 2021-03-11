// @flow strict-local

import type {
  Asset,
  Bundle,
  BundleGroup,
  MutableBundleGraph,
  PluginOptions,
} from '@parcel/types';
import type {SchemaEntity} from '@parcel/utils';

import invariant from 'assert';
import {Bundler} from '@parcel/plugin';
import {loadConfig, md5FromString, validateSchema} from '@parcel/utils';
import nullthrows from 'nullthrows';
import path from 'path';
import {encodeJSONKeyComponent} from '@parcel/diagnostic';

// Default options by http version.
const HTTP_OPTIONS = {
  '1': {
    minBundles: 1,
    minBundleSize: 30000,
    maxParallelRequests: 6,
  },
  '2': {
    minBundles: 1,
    minBundleSize: 20000,
    maxParallelRequests: 25,
  },
};

export default (new Bundler({
  // RULES:
  // 1. If dep.isAsync or dep.isEntry, start a new bundle group.
  // 2. If an asset is a different type than the current bundle, make a parallel bundle in the same bundle group.
  // 3. If an asset is already in a parent bundle in the same entry point, exclude from child bundles.
  // 4. If an asset is only in separate isolated entry points (e.g. workers, different HTML pages), duplicate it.

  loadConfig({options}) {
    return loadBundlerConfig(options);
  },

  bundle({bundleGraph, config}) {
    let bundleRoots: Map<Bundle, Array<Asset>> = new Map();
    let bundlesByEntryAsset: Map<Asset, Bundle> = new Map();

    // Step 1: create bundles for each of the explicit code split points.
    bundleGraph.traverse({
      enter: (node, context, actions) => {
        if (node.type !== 'dependency') {
          return {
            ...context,
            bundleGroup: context?.bundleGroup,
            bundleByType: context?.bundleByType,
            parentNode: node,
            parentBundle:
              bundlesByEntryAsset.get(node.value) ?? context?.parentBundle,
          };
        }

        let dependency = node.value;
        if (bundleGraph.isDependencySkipped(dependency)) {
          actions.skipChildren();
          return;
        }

        let assets = bundleGraph.getDependencyAssets(dependency);
        let resolution = bundleGraph.getDependencyResolution(dependency);
        // Create a new bundle for entries, async deps, isolated assets, and inline assets.
        if (
          (dependency.isEntry && resolution) ||
          (dependency.isAsync && resolution) ||
          (dependency.isIsolated && resolution) ||
          resolution?.isIsolated ||
          resolution?.isInline
        ) {
          let bundleGroup = context?.bundleGroup;
          let bundleByType: Map<string, Bundle> =
            context?.bundleByType ?? new Map();

          // Only create a new bundle group for entries, async dependencies, and isolated assets.
          // Otherwise, the bundle is loaded together with the parent bundle.
          if (
            !bundleGroup ||
            dependency.isEntry ||
            dependency.isAsync ||
            resolution.isIsolated
          ) {
            bundleGroup = bundleGraph.createBundleGroup(
              dependency,
              nullthrows(dependency.target ?? context?.bundleGroup?.target),
            );

            bundleByType = new Map();
          }

          for (let asset of assets) {
            let bundle = bundleGraph.createBundle({
              entryAsset: asset,
              isEntry: asset.isInline ? false : Boolean(dependency.isEntry),
              isInline: asset.isInline,
              target: bundleGroup.target,
            });
            bundleByType.set(bundle.type, bundle);
            bundlesByEntryAsset.set(asset, bundle);
            bundleGraph.addBundleToBundleGroup(bundle, bundleGroup);

            // The bundle may have already been created, and the graph gave us back the original one...
            if (!bundleRoots.has(bundle)) {
              bundleRoots.set(bundle, [asset]);
            }

            // If the bundle is in the same bundle group as the parent, create an asset reference
            // between the dependency, the asset, and the target bundle.
            if (bundleGroup === context?.bundleGroup) {
              bundleGraph.createAssetReference(dependency, asset, bundle);
            }
          }

          return {
            bundleGroup,
            bundleByType,
            parentNode: node,
            parentBundle: context?.parentBundle,
          };
        }

        invariant(context != null);
        invariant(context.parentNode.type === 'asset');
        invariant(context.parentBundle != null);
        let parentAsset = context.parentNode.value;
        let parentBundle = context.parentBundle;
        let bundleGroup = nullthrows(context.bundleGroup);
        let bundleByType = nullthrows(context.bundleByType);

        for (let asset of assets) {
          if (parentAsset.type === asset.type) {
            continue;
          }

          let existingBundle = bundleByType.get(asset.type);
          if (existingBundle) {
            // If a bundle of this type has already been created in this group,
            // merge this subgraph into it.
            nullthrows(bundleRoots.get(existingBundle)).push(asset);
            bundlesByEntryAsset.set(asset, existingBundle);
            bundleGraph.createAssetReference(dependency, asset, existingBundle);
          } else {
            let bundle = bundleGraph.createBundle({
              uniqueKey: asset.id,
              env: asset.env,
              type: asset.type,
              target: bundleGroup.target,
              isEntry:
                asset.isInline || dependency.isEntry === false
                  ? false
                  : parentBundle.isEntry,
              isInline: asset.isInline,
              isSplittable: asset.isSplittable ?? true,
              pipeline: asset.pipeline,
            });
            bundleByType.set(bundle.type, bundle);
            bundlesByEntryAsset.set(asset, bundle);
            bundleGraph.createAssetReference(dependency, asset, bundle);

            // The bundle may have already been created, and the graph gave us back the original one...
            if (!bundleRoots.has(bundle)) {
              bundleRoots.set(bundle, [asset]);
            }
          }
        }

        return {
          ...context,
          parentNode: node,
        };
      },
    });

    for (let [bundle, rootAssets] of bundleRoots) {
      for (let asset of rootAssets) {
        bundleGraph.addEntryToBundle(asset, bundle);
      }
    }
    invariant(config != null);

    // Step 2: Remove asset graphs that begin with entries to other bundles.
    bundleGraph.traverseBundles(bundle => {
      if (bundle.isInline || !bundle.isSplittable || bundle.env.isIsolated()) {
        return;
      }

      // Skip bundles where the entry is reachable in a parent bundle. This can occur when both synchronously and
      // asynchronously importing an asset from a bundle. This asset will later be internalized into the parent.
      let entries = bundle.getEntryAssets();
      let mainEntry = entries[0];
      if (
        mainEntry == null ||
        entries.length !== 1 ||
        bundleGraph.isAssetReachableFromBundle(mainEntry, bundle)
      ) {
        return;
      }

      let candidates = bundleGraph.findBundlesWithAsset(mainEntry).filter(
        containingBundle =>
          containingBundle.id !== bundle.id &&
          // Don't add to BundleGroups for entry bundles, as that would require
          // another entry bundle depending on these conditions, making it difficult
          // to predict and reference.
          !containingBundle.isEntry &&
          !containingBundle.isInline &&
          containingBundle.isSplittable,
      );

      for (let candidate of candidates) {
        let bundleGroups = bundleGraph.getBundleGroupsContainingBundle(
          candidate,
        );
        if (
          Array.from(bundleGroups).every(
            group =>
              bundleGraph
                .getBundlesInBundleGroup(group)
                .filter(b => !b.isInline).length < config.maxParallelRequests,
          )
        ) {
          bundleGraph.createBundleReference(candidate, bundle);
          bundleGraph.removeAssetGraphFromBundle(mainEntry, candidate);
        }
      }
    });

    // Step 3: Remove assets that are duplicated in a parent bundle.
    deduplicate(bundleGraph);

    // Step 4: Mark async dependencies on assets that are already available in
    // the bundle as internally resolvable. This removes the dependency between
    // the bundle and the bundle group providing that asset. If all connections
    // to that bundle group are removed, remove that bundle group.
    let asyncBundleGroups: Set<BundleGroup> = new Set();
    bundleGraph.traverse((node, _, actions) => {
      if (
        node.type !== 'dependency' ||
        node.value.isEntry ||
        !node.value.isAsync
      ) {
        return;
      }

      if (bundleGraph.isDependencySkipped(node.value)) {
        actions.skipChildren();
        return;
      }

      let dependency = node.value;
      if (dependency.isURL) {
        // Don't internalize dependencies on URLs, e.g. `new Worker('foo.js')`
        return;
      }

      let resolution = bundleGraph.getDependencyResolution(dependency);
      if (resolution == null) {
        return;
      }

      let externalResolution = bundleGraph.resolveAsyncDependency(dependency);
      if (externalResolution?.type === 'bundle_group') {
        asyncBundleGroups.add(externalResolution.value);
      }

      for (let bundle of bundleGraph.findBundlesWithDependency(dependency)) {
        if (
          bundle.hasAsset(resolution) ||
          bundleGraph.isAssetReachableFromBundle(resolution, bundle)
        ) {
          bundleGraph.internalizeAsyncDependency(bundle, dependency);
        }
      }
    });

    // Remove any bundle groups that no longer have any parent bundles.
    for (let bundleGroup of asyncBundleGroups) {
      if (bundleGraph.getParentBundlesOfBundleGroup(bundleGroup).length === 0) {
        bundleGraph.removeBundleGroup(bundleGroup);
      }
    }
  },
  optimize({bundleGraph, config}) {
    invariant(config != null);

    // Step 5: Find duplicated assets in different bundle groups, and separate them into their own parallel bundles.
    // If multiple assets are always seen together in the same bundles, combine them together.
    // If the sub-graph from an asset is >= 30kb, and the number of parallel requests in the bundle group is < 5, create a new bundle containing the sub-graph.
    let candidateBundles: Map<
      string,
      {|
        assets: Array<Asset>,
        sourceBundles: Set<Bundle>,
        size: number,
      |},
    > = new Map();

    bundleGraph.traverseContents((node, ctx, actions) => {
      if (node.type !== 'asset') {
        return;
      }

      let asset = node.value;
      let containingBundles = bundleGraph
        .findBundlesWithAsset(asset)
        // Don't create shared bundles from entry bundles, as that would require
        // another entry bundle depending on these conditions, making it difficult
        // to predict and reference.
        .filter(b => {
          let entries = b.getEntryAssets();

          return (
            !b.isEntry &&
            b.isSplittable &&
            entries.every(entry => entry.id !== asset.id)
          );
        });

      if (containingBundles.length > config.minBundles) {
        let id = containingBundles
          .map(b => b.id)
          .sort()
          .join(':');

        let candidate = candidateBundles.get(id);
        if (candidate) {
          candidate.assets.push(asset);
          for (let bundle of containingBundles) {
            candidate.sourceBundles.add(bundle);
          }
          candidate.size += bundleGraph.getTotalSize(asset);
        } else {
          candidateBundles.set(id, {
            assets: [asset],
            sourceBundles: new Set(containingBundles),
            size: bundleGraph.getTotalSize(asset),
          });
        }

        // Skip children from consideration since we added a parent already.
        actions.skipChildren();
      }
    });

    // Sort candidates by size (consider larger bundles first), and ensure they meet the size threshold
    let sortedCandidates: Array<{|
      assets: Array<Asset>,
      sourceBundles: Set<Bundle>,
      size: number,
    |}> = Array.from(candidateBundles.values())
      .filter(bundle => bundle.size >= config.minBundleSize)
      .sort((a, b) => b.size - a.size);

    for (let {assets, sourceBundles} of sortedCandidates) {
      // Find all bundle groups connected to the original bundles
      let bundleGroups = new Set();

      for (let bundle of sourceBundles) {
        for (let bundleGroup of bundleGraph.getBundleGroupsContainingBundle(
          bundle,
        )) {
          bundleGroups.add(bundleGroup);
        }
      }

      // If all bundle groups have already met the max parallel request limit, then they cannot be split.
      if (
        Array.from(bundleGroups).every(
          group =>
            bundleGraph.getBundlesInBundleGroup(group).filter(b => !b.isInline)
              .length >= config.maxParallelRequests,
        )
      ) {
        continue;
      }

      let [firstBundle] = [...sourceBundles];
      let sharedBundle = bundleGraph.createBundle({
        uniqueKey: md5FromString([...sourceBundles].map(b => b.id).join(':')),
        // Allow this bundle to be deduplicated. It shouldn't be further split.
        // TODO: Reconsider bundle/asset flags.
        isSplittable: true,
        env: firstBundle.env,
        target: firstBundle.target,
        type: firstBundle.type,
      });

      // Remove all of the root assets from each of the original bundles
      // and reference the new shared bundle.
      for (let asset of assets) {
        bundleGraph.addAssetGraphToBundle(asset, sharedBundle);

        for (let bundle of sourceBundles) {
          // Remove the asset graph from the bundle if all bundle groups are
          // within the parallel request limit and will include the shared bundle.
          let bundleGroups = bundleGraph.getBundleGroupsContainingBundle(
            bundle,
          );
          if (
            bundleGroups.every(
              bundleGroup =>
                bundleGraph
                  .getBundlesInBundleGroup(bundleGroup)
                  .filter(b => !b.isInline).length < config.maxParallelRequests,
            )
          ) {
            bundleGraph.createBundleReference(bundle, sharedBundle);
            bundleGraph.removeAssetGraphFromBundle(asset, bundle);
          }
        }
      }
    }

    // Remove assets that are duplicated between shared bundles.
    deduplicate(bundleGraph);
  },
}): Bundler);

function deduplicate(bundleGraph: MutableBundleGraph) {
  bundleGraph.traverse(node => {
    if (node.type === 'asset') {
      let asset = node.value;
      // Search in reverse order, so bundles that are loaded keep the duplicated asset, not later ones.
      // This ensures that the earlier bundle is able to execute before the later one.
      let bundles = bundleGraph.findBundlesWithAsset(asset).reverse();
      for (let bundle of bundles) {
        if (
          bundle.hasAsset(asset) &&
          bundleGraph.isAssetReachableFromBundle(asset, bundle)
        ) {
          bundleGraph.removeAssetGraphFromBundle(asset, bundle);
        }
      }
    }
  });
}

const CONFIG_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    http: {
      type: 'number',
      enum: Object.keys(HTTP_OPTIONS).map(k => Number(k)),
    },
    minBundles: {
      type: 'number',
    },
    minBundleSize: {
      type: 'number',
    },
    maxParallelRequests: {
      type: 'number',
    },
  },
  additionalProperties: false,
};

async function loadBundlerConfig(options: PluginOptions) {
  let result = await loadConfig(
    options.inputFS,
    path.join(options.projectRoot, 'index'),
    ['package.json'],
  );

  let config = result?.config['@parcel/bundler-default'];
  if (!config) {
    return {
      config: HTTP_OPTIONS['2'],
      files: result?.files ?? [],
    };
  }

  invariant(result != null);

  validateSchema.diagnostic(
    CONFIG_SCHEMA,
    {
      data: config,
      source: await options.inputFS.readFile(result.files[0].filePath, 'utf8'),
      filePath: result.files[0].filePath,
      prependKey: `/${encodeJSONKeyComponent('@parcel/bundler-default')}`,
    },
    '@parcel/bundler-default',
    'Invalid config for @parcel/bundler-default',
  );

  let http = config.http ?? 2;
  let defaults = HTTP_OPTIONS[http];

  return {
    config: {
      minBundles: config.minBundles ?? defaults.minBundles,
      minBundleSize: config.minBundleSize ?? defaults.minBundleSize,
      maxParallelRequests:
        config.maxParallelRequests ?? defaults.maxParallelRequests,
    },
    files: result.files,
  };
}
