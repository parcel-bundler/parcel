// @flow

import {getFeatureFlag} from '@parcel/feature-flags';
import {Resolver as ResolverNew, ResolverOld} from '@parcel/rust';

export const ResolverBase: typeof ResolverNew = getFeatureFlag(
  'ownedResolverStructures',
)
  ? ResolverNew
  : // $FlowFixMe unfortunately this can't be typed properly. This may be an issue if something does instanceof checks against a direct reference to @parcel/rust, but will be fine otherwise.
    ResolverOld;

export {default} from './Wrapper';
export {init} from '@parcel/rust';
