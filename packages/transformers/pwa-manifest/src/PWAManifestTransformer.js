// @flow
// https://developer.mozilla.org/en-US/docs/Web/Manifest

import {Transformer} from '@parcel/plugin';
import type {MutableAsset} from '@parcel/types';

const getSrcHandler = (opt = {}) => (asset: MutableAsset, dep) => {
  const src = asset.addURLDependency(dep.src, opt);
  return {...dep, src};
};

const handleArray = (asset: MutableAsset, list) => {
  if (!Array.isArray(list)) {
    return list;
  }
  return list.map(getSrcHandler().bind(null, asset));
};

const DEPS = {
  icons: handleArray,
  screenshots: handleArray,
  serviceworker: getSrcHandler({
    isEntry: true,
    env: {context: 'service-worker'},
  }),
};

type JsonObject = {[string]: any};

const collectDependencies = (asset: MutableAsset, json: JsonObject) =>
  Object.keys(DEPS).reduce(
    (acc: JsonObject, key: string) => {
      const value = json[key];
      if (value) {
        const handler = DEPS[key];
        acc[key] = handler(asset, value);
      }
      return acc;
    },
    {...json},
  );

export default new Transformer({
  async transform({asset}) {
    const json = JSON.parse(await asset.getCode());
    const result = collectDependencies(asset, json);
    asset.setCode(JSON.stringify(result));
    return [asset];
  },
});
