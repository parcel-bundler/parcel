// @flow

import {getFeatureFlag} from '@parcel/feature-flags';
import {Resolver, ResolverOld} from '@parcel/rust';

export const getResolverBase = (): typeof Resolver =>
  getFeatureFlag('ownedResolverStructures')
    ? Resolver
    : // $FlowFixMe unfortunately this can't be typed properly. This may be an issue if something does instanceof checks against a direct reference to @parcel/rust, but will be fine otherwise.
      ResolverOld;

export type {Resolver as ResolverBase} from '@parcel/rust';
export {default} from './Wrapper';
export {init} from '@parcel/rust';
