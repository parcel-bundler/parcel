// @flow strict-local

import type {PackageJSON} from '@parcel/types';
import type {ResolveOptions} from 'resolve';

// $FlowFixMe TODO: Type promisify
import promisify from './promisify';

const resolve: (
  id: string,
  opts?: ResolveOptions
) => Promise<[string, ?PackageJSON]> = promisify(require('resolve'));

export default resolve;
