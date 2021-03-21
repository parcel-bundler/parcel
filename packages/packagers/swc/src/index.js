// @flow
import {Packager} from '@parcel/plugin';
import {SWCPackager} from './SWCPackager';

export default (new Packager({
  package({
    bundle,
    bundleGraph,
    getInlineBundleContents,
    getSourceMapReference,
    config,
    options,
  }) {
    return new SWCPackager(
      options,
      bundleGraph,
      bundle,
      'parcelRequire123',
    ).package();
  },
}): Packager);
