// @flow strict-local

import type {
  AssetRequest,
  BundleGroup,
  Environment,
  File,
  FilePath,
  Stats,
  Target
} from '@parcel/types';

import type Asset from './Asset';
import type AssetGraph from './AssetGraph';
import type Dependency from './Dependency';

export type NodeId = string;

export type Edge = {|
  from: NodeId,
  to: NodeId
|};

export interface Node {
  id: string;
  +type?: string;
  // $FlowFixMe
  value: any;
}

export type AssetNode = {|id: string, +type: 'asset', value: Asset|};
export type AssetReferenceNode = {|
  id: string,
  +type: 'asset_reference',
  value: Asset
|};

export type DependencyNode = {|
  id: string,
  type: 'dependency',
  value: Dependency
|};

export type FileNode = {|id: string, +type: 'file', value: File|};
export type RootNode = {|id: string, +type: 'root', value: string | null|};

// Asset group nodes are essentially used as placeholders for the results of an asset request
export type AssetGroup = AssetRequest;
export type AssetGroupNode = {|
  id: string,
  +type: 'asset_group',
  // An asset group node is used to
  value: AssetGroup
|};

export type DepPathRequestNode = {|
  id: string,
  +type: 'dep_path_request',
  value: Dependency
|};

export type AssetRequestNode = {|
  id: string,
  +type: 'asset_request',
  value: AssetRequest
|};

export type AssetGraphNode =
  | AssetGroupNode
  | AssetNode
  | AssetReferenceNode
  | DependencyNode
  | RootNode
  | BundleGroupNode
  | BundleReferenceNode;

export type RequestGraphNode = RequestNode | FileNode;
export type RequestNode = DepPathRequestNode | AssetRequestNode;
export type RequestResult = CacheEntry | AssetRequest | null;

export interface BundleReference {
  +id: string;
  +type: string;
  +env: Environment;
  +isEntry: ?boolean;
  +target: ?Target;
  +filePath: ?FilePath;
  +name: ?string;
  +stats: Stats;
}

export type CacheEntry = {
  filePath: FilePath,
  env: Environment,
  hash: string,
  assets: Array<Asset>,
  initialAssets: ?Array<Asset> // Initial assets, pre-post processing
};

export type Bundle = {|
  assetGraph: AssetGraph,
  id: string,
  type: string,
  env: Environment,
  isEntry: ?boolean,
  target: ?Target,
  filePath: ?FilePath,
  name: ?string,
  stats: Stats
|};

export type BundleNode = {|
  id: string,
  +type: 'bundle',
  value: Bundle
|};

export type BundleReferenceNode = {|
  id: string,
  +type: 'bundle_reference',
  value: BundleReference
|};

export type BundleGroupNode = {|
  id: string,
  +type: 'bundle_group',
  value: BundleGroup
|};

export type BundleGraphNode = BundleNode | BundleGroupNode | RootNode;
