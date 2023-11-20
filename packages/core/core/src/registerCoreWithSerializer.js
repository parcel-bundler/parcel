// @flow
import {Graph} from '@parcel/graph';
import {ctorToName, registerSerializableClass} from './serializer';
import AssetGraph from './AssetGraph';
import BundleGraph from './BundleGraph';
import ParcelConfig from './ParcelConfig';
import {RequestGraph} from './RequestTracker';
import Config from './public/Config';
import packageJson from '../package.json';

export function registerCoreWithSerializer() {
  const packageVersion: mixed = packageJson.version;
  if (typeof packageVersion !== 'string') {
    throw new Error('Expected package version to be a string');
  }

  // $FlowFixMe[incompatible-cast]
  for (let [name, ctor] of (Object.entries({
    AssetGraph,
    Config,
    BundleGraph,
    Graph,
    ParcelConfig,
    RequestGraph,
    // $FlowFixMe[unclear-type]
  }): Array<[string, Class<any>]>)) {
    if (ctorToName.has(ctor)) {
      return;
    }
    registerSerializableClass(packageVersion + ':' + name, ctor);
  }
}
