// @flow
import {Optimizer} from '@parcel/plugin';
import {blobToBuffer} from '@parcel/utils';
import {optimize} from '../native';

export default (new Optimizer({
  async optimize({bundle, contents}) {
    if (!bundle.env.shouldOptimize) {
      return {contents};
    }

    let buffer = await blobToBuffer(contents);
    let optimized = optimize(bundle.type, buffer);
    return {
      contents: optimized.length < buffer.length ? optimized : buffer,
    };
  },
}): Optimizer);
