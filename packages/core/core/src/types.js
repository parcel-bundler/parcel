// @flow strict-local

import type {
  AssetRequest,
  BundleGroup,
  Environment,
  File,
  FilePath,
  Glob,
  ParcelOptions,
  PackageName,
  Semver,
  Stats,
  Target
} from '@parcel/types';

import type Asset from './Asset';
import type Dependency from './Dependency';
import type Config from './public/Config';

export type NodeId = string;

export type Edge<TEdgeType: string | null> = {|
  from: NodeId,
  to: NodeId,
  type: TEdgeType
|};

export interface Node {
  id: string;
  +type?: string;
  // $FlowFixMe
  value: any;
}

export type AssetNode = {|id: string, +type: 'asset', value: Asset|};

export type DependencyNode = {|
  id: string,
  type: 'dependency',
  value: Dependency
|};

export type FileNode = {|id: string, +type: 'file', value: File|};
export type GlobNode = {|id: string, +type: 'glob', value: Glob|};
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
  | DependencyNode
  | RootNode;

export type BundleGraphNode =
  | AssetNode
  | DependencyNode
  | RootNode
  | BundleGroupNode
  | BundleNode;

export type ConfigRequestNode = {|
  id: string,
  +type: 'config_request',
  value: ConfigRequest
|};

export type ConfigRequest = {|
  filePath: FilePath,
  plugin?: PackageName,
  //$FlowFixMe will lock this down more in a future commit
  meta: any,
  result?: Config
|};

export type DepVersionRequestNode = {|
  id: string,
  +type: 'dep_version_request',
  value: DepVersionRequest
|};

export type DepVersionRequest = {|
  moduleSpecifier: PackageName,
  resolveFrom: FilePath,
  result?: Semver
|};

export type RequestGraphNode = RequestNode | FileNode | GlobNode;
export type RequestNode =
  | DepPathRequestNode
  | AssetRequestNode
  | ConfigRequestNode
  | DepVersionRequestNode;
export type SubRequestNode = ConfigRequestNode | DepVersionRequestNode;

export type CacheEntry = {
  filePath: FilePath,
  env: Environment,
  hash: string,
  assets: Array<Asset>,
  initialAssets: ?Array<Asset> // Initial assets, pre-post processing
};

export type Bundle = {|
  id: string,
  type: string,
  env: Environment,
  entryAssetId: ?string,
  isEntry: ?boolean,
  target: Target,
  filePath: ?FilePath,
  name: ?string,
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

export type TransformationOpts = {|
  request: AssetRequest,
  loadConfig: (ConfigRequest, NodeId) => Promise<Config>,
  parentNodeId: NodeId,
  options: ParcelOptions
|};

export type ValidationOpts = {|
  request: AssetRequest,
  loadConfig: (ConfigRequest, NodeId) => Promise<Config>,
  parentNodeId: NodeId,
  options: ParcelOptions
|};
