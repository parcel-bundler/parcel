// @flow
import type {
  BundleGroup as IBundleGroup,
  Target as ITarget,
} from '@atlaspack/types';
import type {
  BundleGroup as InternalBundleGroup,
  AtlaspackOptions,
} from '../types';

import nullthrows from 'nullthrows';
import Target from './Target';

const internalBundleGroupToBundleGroup: WeakMap<
  InternalBundleGroup,
  BundleGroup,
> = new WeakMap();
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
  #options /*: AtlaspackOptions */;

  constructor(
    bundleGroup: InternalBundleGroup,
    options: AtlaspackOptions,
  ): BundleGroup {
    let existing = internalBundleGroupToBundleGroup.get(bundleGroup);
    if (existing != null) {
      return existing;
    }

    this.#bundleGroup = bundleGroup;
    this.#options = options;
    _bundleGroupToInternalBundleGroup.set(this, bundleGroup);
    internalBundleGroupToBundleGroup.set(bundleGroup, this);
    return this;
  }

  get target(): ITarget {
    return new Target(this.#bundleGroup.target, this.#options);
  }

  get entryAssetId(): string {
    return this.#bundleGroup.entryAssetId;
  }
}
