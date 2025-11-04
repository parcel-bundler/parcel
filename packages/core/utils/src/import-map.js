// @flow
import type {BundleGraph, NamedBundle} from '@parcel/types';
import {normalizeSeparators} from './path';

let importMapCache = new WeakMap();

export function getImportMap(
  bundleGraph: BundleGraph<NamedBundle>,
  entryBundle: NamedBundle,
): {[string]: string} {
  let cache = importMapCache.get(bundleGraph);
  if (!cache) {
    cache = new WeakMap();
    importMapCache.set(bundleGraph, cache);
  }

  let cached = cache.get(entryBundle);
  if (cached) {
    return cached;
  }

  let mappings = {};
  for (let childBundle of bundleGraph.getChildBundles(entryBundle)) {
    bundleGraph.traverseBundles((bundle, _, actions) => {
      if (bundle.bundleBehavior === 'inline') {
        return;
      }

      mappings[bundle.publicId] = normalizeSeparators(bundle.name);

      if (bundle !== entryBundle && isNewContext(bundle, bundleGraph)) {
        for (let referenced of bundleGraph.getReferencedBundles(bundle)) {
          mappings[referenced.publicId] = normalizeSeparators(referenced.name);
        }
        // New contexts have their own manifests, so there's no need to continue.
        actions.skipChildren();
      }
    }, childBundle);
  }

  cache.set(entryBundle, mappings);
  return mappings;
}

function isNewContext(
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
): boolean {
  let parents = bundleGraph.getParentBundles(bundle);
  return (
    parents.length === 0 ||
    parents.some(
      parent =>
        parent.env.context !== bundle.env.context || parent.type !== 'js',
    )
  );
}
