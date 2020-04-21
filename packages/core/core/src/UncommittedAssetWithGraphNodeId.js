// @flow strict-local

import UncommittedAsset from './UncommittedAsset';
import type {UncommittedAssetOptions} from './UncommittedAsset';

type UncommittedAssetWithGraphNodeIdOptions = {|
  ...UncommittedAssetOptions,
  assetGraphNodeId: string,
|};

// ANDREW_TODO: this a hacky way of passing around a graphNodeId so it can be used to look up dependent assets within a Validator. There's probably a better way.
export default class UncommittedAssetWithGraphNodeId extends UncommittedAsset {
  assetGraphNodeId: string;
  constructor(opts: UncommittedAssetWithGraphNodeIdOptions) {
    let {assetGraphNodeId, ...rest} = opts;
    super(rest);
    this.assetGraphNodeId = assetGraphNodeId;
  }
}
