// @flow strict-local

import {registerSerializableClass} from '@parcel/utils';
import AssetGraph from './AssetGraph';
import BundleGraph from './BundleGraph';
import Graph from './Graph';
import ParcelConfig from './ParcelConfig';
import {RequestGraph} from './RequestTracker';
import Config from './public/Config';
// $FlowFixMe this is untyped
import packageJson from '../package.json';

const packageVersion = packageJson.version;
if (typeof packageVersion !== 'string') {
  throw new Error('Expected package version to be a string');
}

let registered;
export default function registerCoreWithSerializer() {
  if (registered) {
    return;
  }

  for (let ctor of [
    AssetGraph,
    Config,
    BundleGraph,
    Graph,
    ParcelConfig,
    RequestGraph
  ]) {
    register(ctor);
  }

  registered = true;
}

function register(ctor: Class<*>): void {
  registerSerializableClass(packageVersion + ':' + ctor.name, ctor);
}
