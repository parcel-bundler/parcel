// @flow
import {ParcelNode} from '@parcel/node';

export const parcel = (new ParcelNode({
  defaultConfig: require.resolve('@parcel/config-default'),
}): ParcelNode);
