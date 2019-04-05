// @flow strict-local

import type {
  Asset,
  BundleGroup,
  Dependency,
  Environment,
  File,
  FilePath,
  Target,
  TransformerRequest,
  Stats
} from '@parcel/types';

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
  // Bundle graphs are merged into asset graphs during the bundling phase
  | BundleGraphNode;

export type Bundle = {|
  id: string,
  type: string,
  assetGraph: AssetGraph,
  env: Environment,
  isEntry: ?boolean,
  target: ?Target,
  filePath: ?FilePath,
  stats: Stats
|};

export type BundleNode = {|
  id: string,
  +type: 'bundle',
  value: Bundle
|};

export type BundleGroupNode = {|
  id: string,
  +type: 'bundle_group',
  value: BundleGroup
|};

export type BundleGraphNode = BundleNode | BundleGroupNode | RootNode;
