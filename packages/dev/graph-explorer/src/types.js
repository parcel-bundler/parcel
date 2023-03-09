// @flow strict-local
/* eslint-disable monorepo/no-internal-import */

import type BundleGraph from '@parcel/core/src/BundleGraph';
import type AssetGraph from '@parcel/core/src/AssetGraph';
import type RequestTracker, {
  RequestGraph,
} from '@parcel/core/src/RequestTracker';

import type {NodeId, ContentKey, ContentGraph} from '@parcel/graph';

import type {
  AssetGraphNode,
  AssetGroupNode,
  AssetNode,
  BundleGraphNode,
  BundleGroupNode,
  BundleNode,
  DependencyNode,
  EntryFileNode,
  EntrySpecifierNode,
  PackagedBundleInfo,
  RootNode,
} from '@parcel/core/src/types';

export {BundleBehaviorNames} from '@parcel/core/src/types';

type RequestGraphNode = $Call<<T>(ContentGraph<T, mixed>) => T, RequestGraph>;

export type {
  AssetGraph,
  AssetGraphNode,
  AssetGroupNode,
  AssetNode,
  BundleGraph,
  BundleGraphNode,
  BundleGroupNode,
  BundleNode,
  ContentKey,
  DependencyNode,
  EntryFileNode,
  EntrySpecifierNode,
  NodeId,
  PackagedBundleInfo,
  RequestGraph,
  RequestGraphNode,
  RequestTracker,
  RootNode,
};

export type NodeInput = {|
  id: NodeId | ContentKey,
|};

export type NodeListInput = {|
  ids?: Array<NodeId | ContentKey>,
|};

export type EntryListInput = NodeListInput & {|
  specifiers?: Array<string>,
|};

export type GraphContext = {|
  assetGraph: AssetGraph,
  bundleGraph: BundleGraph,
  requestTracker: RequestTracker,
  bundleInfo: Map<ContentKey, PackagedBundleInfo>,
|};

export type QueryContext = GraphContext & {|
  /** The HTTP request */
  request: Request,
  /** Parameters of GraphQL Request */
  params: {|
    /** the DocumentNode that was parsed from the GraphQL query string sent by a client */
    query: mixed,
    /** the operation name selected from the incoming query sent by a client */
    operationName: string,
    /** the variables that were defined in the query sent by a client */
    variables: mixed,
    /** the extensions that were received from the client sent by a client */
    extensions: mixed,
  |},
|};

export type Resolver = (
  // $FlowFixMe[unclear-type]
  parent: any,
  // $FlowFixMe[unclear-type]
  args: any,
  ctx: QueryContext,
  // $FlowFixMe[unclear-type]
  info: any,
) => mixed;

export type ResolverMap = {
  [string]: Resolver | ResolverMap,
};

export type ResolverModule = {
  typeDefs?: string,
  resolvers?: ResolverMap,
  ...
};
