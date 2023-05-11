// @flow strict-local

import {Namer} from '@parcel/plugin';
import nullthrows from 'nullthrows';

export default (new Namer({
  name({bundle, bundleGraph}) {
    let bundleGroup = bundleGraph.getBundleGroupsContainingBundle(bundle)[0];
    let entryAsset = nullthrows(
      bundle.getEntryAssets().find(a => a.id === bundleGroup.entryAssetId),
    );

    let chunkNameMagicComments: Array<string> = bundleGraph
      .getIncomingDependencies(entryAsset)
      // $FlowFixMe
      .map(d => d.meta.chunkNameMagicComment)
      .filter(Boolean);
    if (chunkNameMagicComments.length > 0) {
      let name = chunkNameMagicComments.sort()[0]; // An arbitrary choice
      if (!bundle.needsStableName) {
        name += '.' + bundle.hashReference;
      }
      return name + '.' + bundle.type;
    }
  },
}): Namer);
