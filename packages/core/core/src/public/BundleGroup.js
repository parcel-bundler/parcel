// @flow
import type {
  BundleGroup as IBundleGroup,
  Target as ITarget,
} from '@parcel/types';
import {readCachedString} from '@parcel/rust';
import type {BundleGroup as InternalBundleGroup, ParcelOptions} from '../types';

import nullthrows from 'nullthrows';
import Target from './Target';
import type {Scope} from '../scopeCache';
import {getScopeCache} from '../scopeCache';

const _bundleGroupToInternalBundleGroup: WeakMap<
  IBundleGroup,
  InternalBundleGroup,
> = new WeakMap();
export function bundleGroupToInternalBundleGroup(
  target: IBundleGroup,
): InternalBundleGroup {
  return nullthrows(_bundleGroupToInternalBundleGroup.get(target));
}

export default class BundleGroup implements IBundleGroup {
  #bundleGroup /*: InternalBundleGroup */;
  #options /*: ParcelOptions */;
  #scope: Scope;

  constructor(
    bundleGroup: InternalBundleGroup,
    options: ParcelOptions,
    scope: Scope,
  ): BundleGroup {
    let cache = getScopeCache(scope, 'BundleGroup');

    let existing = cache.get(bundleGroup);
    if (existing != null) {
      return existing;
    }

    this.#bundleGroup = bundleGroup;
    this.#options = options;
    this.#scope = scope;
    _bundleGroupToInternalBundleGroup.set(this, bundleGroup);
    cache.set(bundleGroup, this);
    return this;
  }

  get target(): ITarget {
    return new Target(this.#bundleGroup.target, this.#options, this.#scope);
  }

  get entryAssetId(): string {
    return readCachedString(this.#options.db, this.#bundleGroup.entryAssetId);
  }
}
