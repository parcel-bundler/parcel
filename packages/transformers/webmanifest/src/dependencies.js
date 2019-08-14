// @flow

import type {MutableAsset} from '@parcel/types';

import nullthrows from 'nullthrows';

const handleSrcItem = (asset, {src}) => {
  asset.addURLDependency(src, {});
};

const handleArray = (asset, list) => {
  if (!Array.isArray(list)) {
    return;
  }
  list.forEach(handleSrcItem.bind(null, asset));
};

// A list of all properties that may produce a dependency
// Based on https://developer.mozilla.org/en-US/docs/Web/Manifest#Members
const HANDLERS = {
  icons: handleArray,
  screenshots: handleArray,
  serviceworker: handleSrcItem
};

export default function collectDependencies(
  asset: MutableAsset,
  json: {[string]: any}
) {
  nullthrows(json);
  Object.keys(HANDLERS).forEach(key => {
    if (json[key]) {
      HANDLERS[key](asset, json[key]);
    }
  });
}
