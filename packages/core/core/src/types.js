// @flow strict-local

import type {
  BundleGroup,
  Dependency,
  Environment,
  File,
  FilePath,
  Stats,
  Target,
  TransformerRequest
} from '@parcel/types';

import type Asset from './Asset';
import type AssetGraph from './AssetGraph';

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

export type TransformerRequestNode = {|
  id: string,
  +type: 'transformer_request',
  value: TransformerRequest
|};

export type AssetGraphNode =
  | AssetNode
  | AssetReferenceNode
  | DependencyNode
  | FileNode
  | RootNode
  | TransformerRequestNode
  | BundleGroupNode
  | BundleReferenceNode;

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
