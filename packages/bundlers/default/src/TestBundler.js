// @flow strict-local
import type {
  Asset,
  Bundle,
  BundleGroup,
  Config,
  CreateBundleOpts,
  Dependency,
  Facet,
  MutableBundleGraph,
  PluginOptions,
  Target,
} from '@parcel/types';
import {DefaultMap} from '@parcel/utils';

import {Bundler} from '@parcel/plugin';
import {validateSchema, type SchemaEntity} from '@parcel/utils';
import {hashString} from '@parcel/hash';
import nullthrows from 'nullthrows';
import {encodeJSONKeyComponent} from '@parcel/diagnostic';
import invariant from 'assert';

type BundlerConfig = {|
  http?: number,
  minBundles?: number,
  minBundleSize?: number,
  maxParallelRequests?: number,
|};

// type ResolvedBundlerConfig = {|
//   minBundles: number,
//   minBundleSize: number,
//   maxParallelRequests: number,
// |};

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
  loadConfig({config, options}) {
    return loadBundlerConfig(config, options);
  },
  bundle({bundleGraph}) {
    let {targetFacets, transitiveFacets} = getFacets(bundleGraph);
    // console.log(transitiveFacets);

    let bundles: Array<{|
      opts: CreateBundleOpts,
      entry: Asset,
      assets: Set<Asset>,
    |}> = [];
    let bundleGroups: Array<{|
      dep: Dependency,
      bundles: Set<number>,
      facet: ?Facet,
    |}> = [];
    let assetReferences: Array<[Dependency, Asset, number]> = [];
    let removeDependencyFromBundle: Array<[Dependency, number]> = [];
    function bundle(
      bundleGraph: MutableBundleGraph,
      target: Target,
      facet: ?Set<Facet>,
      transitiveFacets: ?Map<Dependency, Set<Facet>>,
    ) {
      // console.log('-----', facet);
      let lastFacet = facet ? last([...facet]) : undefined;
      bundleGraph.traverse((node, ctx, actions) => {
        if (ctx == null) {
          invariant(node.type === 'dependency');
          if (node.value.target != target) {
            actions.stop();
            return;
          }
        }

        if (node.type === 'asset') {
          let asset = node.value;
          let {dep, target, bundleGroup, bundle: ctxBundle} = nullthrows(ctx);
          let bundle;
          if (
            ctxBundle == null ||
            nullthrows(bundles[ctxBundle].opts.type) != asset.type
          ) {
            // console.log(
            //   'new bundle',
            //   ctxBundle != null && bundles[ctxBundle]?.opts.type,
            //   asset,
            // );
            bundles.push({
              opts: {
                type: asset.type,
                env: asset.env,
                uniqueKey: asset.id,
                target,
                facet: lastFacet ?? undefined,
                needsStableName: facet == null ? dep.isEntry : false,
                bundleBehavior: dep.bundleBehavior,
                pipeline: asset.pipeline,
                isSplittable: asset.isBundleSplittable,
              },
              entry: asset,
              assets: new Set([asset]),
            });
            // bundleGraph.addEntryToBundle(asset, bundle)
            bundle = bundles.length - 1;
            bundleGroups[bundleGroup].bundles.add(bundle); // bundleGraph.addBundleToBundleGroup(bundle, bundleGroup);
          } else {
            // console.log(
            //   'reu bundle',
            //   ctxBundle != null && bundles[ctxBundle]?.opts.type,
            //   asset,
            // );
            bundle = ctxBundle;
            bundles[bundle].assets.add(asset); // bundleGraph.addAssetToBundle(asset, bundle);
          }
          // if (!dep.isEntry) {
          // assetReferences.push([dep, asset, bundle]);
          // bundleGraph.createAssetReference(dep, asset, bundle);
          // }
          return {
            dep,
            target,
            bundle,
            bundleGroup,
          };
        } else {
          let dep = node.value;
          if (
            bundleGraph.isDependencySkipped(dep) ||
            (dep.facet != null &&
              facet != null &&
              transitiveFacets &&
              transitiveFacets.has(dep) &&
              !isPrefix(nullthrows(transitiveFacets.get(dep)), facet))
            // !transitiveFacets.get(dep)?.has(facet)
            // !facet.startsWith(dep.facet)
          ) {
            // console.log('skip', facet, dep, transitiveFacets?.get(dep));
            if (ctx?.bundle != null) {
              removeDependencyFromBundle.push([dep, ctx.bundle]);
              // bundleGraph.removeDependencyFromBundle(dep, ctx.bundle);
            }
            actions.skipChildren();
            return;
          }
          let bundleGroup = ctx?.bundleGroup;
          if (bundleGroup == null) {
            bundleGroups.push({
              dep,
              bundles: new Set(),
              facet: lastFacet,
            });
            bundleGroup = bundleGroups.length - 1;
          }
          return {
            dep,
            target: nullthrows(dep.target ?? ctx?.target),
            bundle: ctx?.bundle,
            bundleGroup /*
              :ctx?.bundleGroup ??
              bundleGraph.createBundleGroup(dep, nullthrows(dep.target)), */,
          };
        }
      });
    }

    for (let [target, facets] of targetFacets) {
      if (facets.size > 0) {
        for (let facet of facets) {
          // TODO how to detect automatically
          if (last(facet) === '/blog') {
            continue;
          }
          bundle(bundleGraph, target, facet, transitiveFacets);
        }
      } else {
        bundle(bundleGraph, target, null, null);
      }
    }

    let createdBundles = [];
    for (let b of bundles) {
      let bundle = bundleGraph.createBundle(b.opts);
      createdBundles.push(bundle);
      bundleGraph.addEntryToBundle(b.entry, bundle);
      for (let a of b.assets) {
        bundleGraph.addAssetToBundle(a, bundle);
      }
    }
    for (let {dep, bundles, facet} of bundleGroups) {
      let bundleGroup = bundleGraph.createBundleGroup(
        dep,
        nullthrows(dep.target),
        facet,
      );
      for (let bundle of bundles) {
        bundleGraph.addBundleToBundleGroup(createdBundles[bundle], bundleGroup);
      }
    }
    for (let [dep, asset, bundle] of assetReferences) {
      bundleGraph.createAssetReference(dep, asset, createdBundles[bundle]);
    }
    for (let [dep, bundle] of removeDependencyFromBundle) {
      if (createdBundles[bundle].hasDependency(dep)) {
        bundleGraph.removeDependencyFromBundle(dep, createdBundles[bundle]);
      }
    }
  },
  optimize({bundleGraph, config}) {
    optimize({bundleGraph, config});
  },
}): Bundler);

function getFacets(bundleGraph: MutableBundleGraph): {|
  targetFacets: Map<Target, Set<Set<Facet>>>,
  transitiveFacets: Map<Dependency, Set<Facet>>,
|} {
  let targetFacets: DefaultMap<Target, Set<Set<Facet>>> = new DefaultMap(
    () => new Set(),
  );
  let transitiveFacets: DefaultMap<Dependency, Set<Facet>> = new DefaultMap(
    () => new Set(),
  );
  bundleGraph.traverse({
    enter(node, ctx) {
      if (node.type === 'asset') {
        return ctx;
      } else {
        let dep = node.value;
        let target = nullthrows(ctx?.target ?? dep.target);
        let facet = dep.facet;
        let mergedFacets = ctx?.mergedFacets ?? new Set();
        targetFacets.get(target);
        if (facet != null) {
          mergedFacets = new Set([...(ctx?.mergedFacets ?? []), facet]);
          targetFacets.get(target).add(mergedFacets);
          for (let f of mergedFacets) {
            transitiveFacets.get(dep).add(f);
          }
        }
        return {target, mergedFacets};
      }
    },
  });
  return {targetFacets, transitiveFacets};
}

function last<T>(v: Iterable<T>): T {
  let arr = [...v];
  return arr[arr.length - 1];
}

function isPrefix<T>(prefix: Set<T>, value: Set<T>) {
  let v = [...value];
  let i = 0;
  for (let p of prefix) {
    if (v[i++] != p) {
      return false;
    }
  }
  return true;
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
async function loadBundlerConfig(config: Config, options: PluginOptions) {
  let conf = await config.getConfig<BundlerConfig>([], {
    packageKey: '@parcel/bundler-default',
  });
  if (!conf) {
    return HTTP_OPTIONS['2'];
  }

  invariant(conf?.contents != null);

  validateSchema.diagnostic(
    CONFIG_SCHEMA,
    {
      data: conf?.contents,
      source: await options.inputFS.readFile(conf.filePath, 'utf8'),
      filePath: conf.filePath,
      prependKey: `/${encodeJSONKeyComponent('@parcel/bundler-default')}`,
    },
    '@parcel/bundler-default',
    'Invalid config for @parcel/bundler-default',
  );

  let http = conf.contents.http ?? 2;
  let defaults = HTTP_OPTIONS[http];

  return {
    minBundles: conf.contents.minBundles ?? defaults.minBundles,
    minBundleSize: conf.contents.minBundleSize ?? defaults.minBundleSize,
    maxParallelRequests:
      conf.contents.maxParallelRequests ?? defaults.maxParallelRequests,
  };
}

function optimize({bundleGraph, config}) {
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

  bundleGraph.traverse(node => {
    if (
      node.type !== 'asset' /* ||
      // Don't share assets that have deps with facets. Without this, all assets of every facet
      // bundle just get deduplicated into a shared bundled
      // TODO make more fine grained
      bundleGraph.getDependencies(node.value).some(d => d.facet != null) */
    ) {
      return;
    }

    let asset = node.value;
    let containingBundles = bundleGraph
      .getBundlesWithAsset(asset)
      // Don't create shared bundles from entry bundles, as that would require
      // another entry bundle depending on these conditions, making it difficult
      // to predict and reference.
      // TODO: reconsider this. This is only true for the global output format.
      // This also currently affects other bundles with stable names, e.g. service workers.
      .filter(b => {
        let entries = b.getEntryAssets();

        return (
          !b.needsStableName &&
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
        candidate.size += asset.stats.size;
      } else {
        candidateBundles.set(id, {
          assets: [asset],
          sourceBundles: new Set(containingBundles),
          size: bundleGraph.getTotalSize(asset),
        });
      }

      // Skip children from consideration since we added a parent already.
      // actions.skipChildren();
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

  // console.log(
  //   sortedCandidates.map(c => ({
  //     assets: c.assets,
  //     size: c.size,
  //     sourceBundles: [...c.sourceBundles].map(b => b.facet),
  //   })),
  // );
  for (let {assets, sourceBundles} of sortedCandidates) {
    let eligibleSourceBundles = new Set();

    for (let bundle of sourceBundles) {
      // Find all bundle groups connected to the original bundles
      let bundleGroups = bundleGraph.getBundleGroupsContainingBundle(bundle);
      // Check if all bundle groups are within the parallel request limit
      if (
        bundleGroups.every(
          group =>
            bundleGraph.getBundlesInBundleGroup(group).length <
            config.maxParallelRequests,
        )
      ) {
        eligibleSourceBundles.add(bundle);
      }
    }

    // Do not create a shared bundle unless there are at least 2 source bundles
    if (eligibleSourceBundles.size < 2) {
      continue;
    }

    let [firstBundle] = [...eligibleSourceBundles];
    let sharedBundle = bundleGraph.createBundle({
      uniqueKey: hashString(
        [...eligibleSourceBundles].map(b => b.id).join(':'),
      ),
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
      bundleGraph.addAssetToBundle(asset, sharedBundle);

      for (let bundle of eligibleSourceBundles) {
        {
          bundleGraph.createBundleReference(bundle, sharedBundle);
          bundleGraph.removeAssetFromBundle(asset, bundle);
        }
      }
    }
  }

  // Remove assets that are duplicated between shared bundles.
  deduplicate(bundleGraph);
  internalizeReachableAsyncDependencies(bundleGraph);
}

function internalizeReachableAsyncDependencies(
  bundleGraph: MutableBundleGraph,
): void {
  // Mark async dependencies on assets that are already available in
  // the bundle as internally resolvable. This removes the dependency between
  // the bundle and the bundle group providing that asset. If all connections
  // to that bundle group are removed, remove that bundle group.
  let asyncBundleGroups: Set<BundleGroup> = new Set();
  bundleGraph.traverse((node, _, actions) => {
    if (
      node.type !== 'dependency' ||
      node.value.isEntry ||
      node.value.priority !== 'lazy'
    ) {
      return;
    }

    if (bundleGraph.isDependencySkipped(node.value)) {
      actions.skipChildren();
      return;
    }

    let dependency = node.value;
    if (dependency.specifierType === 'url') {
      // Don't internalize dependencies on URLs, e.g. `new Worker('foo.js')`
      return;
    }

    let resolution = bundleGraph.getResolvedAsset(dependency);
    if (resolution == null) {
      return;
    }

    let externalResolution = bundleGraph.resolveAsyncDependency(dependency);
    if (externalResolution?.type === 'bundle_group') {
      asyncBundleGroups.add(externalResolution.value);
    }

    for (let bundle of bundleGraph.getBundlesWithDependency(dependency)) {
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
}

function deduplicate(bundleGraph: MutableBundleGraph) {
  bundleGraph.traverse(node => {
    if (node.type === 'asset') {
      let asset = node.value;
      // Search in reverse order, so bundles that are loaded keep the duplicated asset, not later ones.
      // This ensures that the earlier bundle is able to execute before the later one.
      let bundles = bundleGraph.getBundlesWithAsset(asset); //.reverse();
      for (let bundle of bundles) {
        // console.log('dedupe   ', asset, bundle.facet);
        if (
          bundle.hasAsset(asset) &&
          bundleGraph.isAssetReachableFromBundle(asset, bundle)
        ) {
          // console.log(
          //   'dedupe rm',
          //   asset,
          //   bundle.facet,
          //   bundleGraph.getBundlesWithAsset(asset).map(b => b.facet),
          // );
          bundleGraph.removeAssetFromBundle(asset, bundle);
        }
      }
    }
  });
}
