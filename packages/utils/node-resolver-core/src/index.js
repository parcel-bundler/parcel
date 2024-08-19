// @flow

import {getFeatureFlag} from '@atlaspack/feature-flags';
import {Resolver as ResolverNew, ResolverOld} from '@atlaspack/rust';

export const ResolverBase: typeof ResolverNew = getFeatureFlag(
  'ownedResolverStructures',
)
  ? ResolverNew
  : // $FlowFixMe unfortunately this can't be typed properly. This may be an issue if something does instanceof checks against a direct reference to @atlaspack/rust, but will be fine otherwise.
    ResolverOld;

export {default} from './Wrapper';
export {init} from '@atlaspack/rust';
