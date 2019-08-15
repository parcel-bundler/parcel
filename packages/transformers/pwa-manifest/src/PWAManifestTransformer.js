// @flow
// https://developer.mozilla.org/en-US/docs/Web/Manifest

import {Transformer} from '@parcel/plugin';
import type {MutableAsset} from '@parcel/types';

import nullthrows from 'nullthrows';

const getSrcHandler = (opt = {}) => (asset, dep) => {
  dep.src = asset.addURLDependency(dep.src, opt);
};

const handleArray = (asset, list) => {
  if (!Array.isArray(list)) {
    return;
  }
  list.forEach(getSrcHandler().bind(null, asset));
};

const DEPS = {
  icons: handleArray,
  screenshots: handleArray,
  serviceworker: getSrcHandler({
    isEntry: true,
    env: {context: 'service-worker'}
  })
};

const collectDependencies = (asset: MutableAsset) => {
  const ast = nullthrows(asset.ast);

  Object.keys(DEPS).forEach(key => {
    // $FlowFixMe
    let node = ast[key];
    if (node) {
      const handler = DEPS[key];
      handler(asset, node);
    }
  });
};

export default new Transformer({
  async parse({asset}) {
    return JSON.parse(await asset.getCode());
  },

  async transform({asset}) {
    collectDependencies(asset);
    return [asset];
  },

  generate({asset}) {
    return {
      code: JSON.stringify(asset.ast) || ''
    };
  }
});
