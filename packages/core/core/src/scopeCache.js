// @flow strict-local

export type Scope = interface {};
type SubCacheKey = string;

const scopeCache = new WeakMap<Scope, Map<SubCacheKey, Map<mixed, mixed>>>();

export function getScopeCache<Key, Value>(
  scope: Scope,
  key: SubCacheKey,
): Map<Key, Value> {
  let cache = scopeCache.get(scope);

  if (!cache) {
    cache = new Map();
    scopeCache.set(scope, cache);
  }

  let subCache = cache.get(key);

  if (!subCache) {
    subCache = new Map();
    cache.set(key, subCache);
  }

  // $FlowFixMe[incompatible-return]
  return subCache;
}
