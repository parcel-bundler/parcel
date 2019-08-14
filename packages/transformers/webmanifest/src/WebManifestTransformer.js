// @flow

import {Transformer} from '@parcel/plugin';

import collectDependencies from './dependencies';

export default new Transformer({
  async transform({asset}) {
    const json = JSON.parse(await asset.getCode());
    collectDependencies(asset, json);
    return [asset];
  }
});
