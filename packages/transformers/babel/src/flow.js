// @flow
import type {MutableAsset} from '@parcel/types';

/**
 * Generates a babel config for stripping away Flow types.
 */
export default async function getFlowConfig(asset: MutableAsset) {
  if (/^(\/{2}|\/\*+) *@flow/.test((await asset.getCode()).substring(0, 20))) {
    return {
      internal: true,
      babelVersion: 7,
      config: {
        plugins: [[require('@babel/plugin-transform-flow-strip-types')]]
      }
    };
  }

  return null;
}
