// @flow strict-local
/* eslint-disable no-console, monorepo/no-internal-import */
import type {ContentKey, NodeId} from '@parcel/graph';
import type {PackagedBundleInfo} from '@parcel/core/src/types';

import v8 from 'v8';
import nullthrows from 'nullthrows';
import invariant from 'assert';

const {
  AssetGraph,
  BundleGraph: {default: BundleGraph},
  RequestTracker: {
    default: RequestTracker,
    readAndDeserializeRequestGraph,
    requestTypes,
    getRequestTrackerCacheInfo,
    requestGraphEdgeTypes,
  },
  LMDBCache,
} = require('./deep-imports.js');

type CacheInfo = Map<string, Array<string | number>>;

async function loadRequestTracker(
  cache: LMDBCache,
  cacheInfo: CacheInfo,
  requestGraphKey: string,
): null | RequestTracker {
  if (requestGraphKey == null) {
    return null;
  }

  console.log('Loading RequestGraph', {requestGraphKey});
  try {
    let date = Date.now();
    let {requestGraph, bufferLength} = await readAndDeserializeRequestGraph(
      cache,
      requestGraphKey,
      requestGraphKey.replace('requestGraph-', ''),
    );

    const requestTracker = new RequestTracker({
      graph: requestGraph,
      // $FlowFixMe
      farm: null,
      // $FlowFixMe
      options: null,
    });
    let timeToDeserialize = Date.now() - date;
    cacheInfo.set('RequestGraph', [bufferLength]);
    cacheInfo.get('RequestGraph')?.push(timeToDeserialize);

    return requestTracker;
  } catch (e) {
    console.error('Error loading Request Graph\n', e);
    return null;
  }
}

/**
 * Both bundle and asset graphs are loaded by looking at the request tracker and
 * finding the last asset/bundle graph requests.
 *
 * The last request on the tracker should be the latest build. This is * coupled
 * to how the graph nodes are ordered (insertion order).
 */
async function loadBundleGraph(
  cacheInfo: CacheInfo,
  requestTracker: RequestTracker,
  cache: LMDBCache,
): BundleGraph {
  try {
    const bundleGraphNode = requestTracker.graph.nodes.findLast(
      node => node.requestType === requestTypes.bundle_graph_request,
    );

    const bundleGraphKey = bundleGraphNode?.resultCacheKey;
    console.log('Loading bundle graph from request tracker', {bundleGraphKey});
    if (bundleGraphKey == null) {
      return null;
    }

    let file = await cache.getLargeBlob(bundleGraphKey);

    let timeToDeserialize = Date.now();
    let obj = v8.deserialize(file);
    invariant(obj.bundleGraph != null);
    const bundleGraph = BundleGraph.deserialize(obj.bundleGraph.value);
    timeToDeserialize = Date.now() - timeToDeserialize;

    cacheInfo.set('BundleGraph', [Buffer.byteLength(file)]);
    cacheInfo.get('BundleGraph')?.push(timeToDeserialize);

    return bundleGraph;
  } catch (e) {
    console.log('Error loading Bundle Graph\n', e);
    return null;
  }
}

async function loadAssetGraph(
  cacheInfo: CacheInfo,
  requestTracker: RequestTracker,
  cache: LMDBCache,
): AssetGraph | null {
  try {
    const assetGraphNode = requestTracker.graph.nodes.findLast(
      node => node.requestType === requestTypes.asset_graph_request,
    );

    const assetGraphKey = assetGraphNode?.resultCacheKey;
    console.log('Loading asset graph from request tracker', {assetGraphKey});
    if (assetGraphKey == null) {
      return;
    }

    let file = await cache.getLargeBlob(assetGraphKey);

    let timeToDeserialize = Date.now();
    let obj = v8.deserialize(file);
    invariant(obj.assetGraph != null);
    const assetGraph = AssetGraph.deserialize(obj.assetGraph.value);
    timeToDeserialize = Date.now() - timeToDeserialize;

    cacheInfo.set('AssetGraph', [Buffer.byteLength(file)]);
    cacheInfo.get('AssetGraph')?.push(timeToDeserialize);
    return assetGraph;
  } catch (e) {
    console.log('Error loading Asset Graph\n', e);
    return null;
  }
}

export async function loadGraphs(cacheDir: string): Promise<{|
  assetGraph: ?AssetGraph,
  bundleGraph: ?BundleGraph,
  requestTracker: ?RequestTracker,
  bundleInfo: ?Map<ContentKey, PackagedBundleInfo>,
  cacheInfo: ?Map<string, Array<string | number>>,
|}> {
  let cacheInfo: CacheInfo = new Map();

  const cache = new LMDBCache(cacheDir);
  const requestTrackerCacheInfo = await getRequestTrackerCacheInfo(cache);
  console.log('Loaded RequestTrackerCacheInfo', requestTrackerCacheInfo);
  const requestGraphKey = requestTrackerCacheInfo?.requestGraphKey;

  // Get requestTracker
  const requestTracker = await loadRequestTracker(
    cache,
    cacheInfo,
    requestGraphKey,
  );
  const bundleGraph = await loadBundleGraph(cacheInfo, requestTracker, cache);
  const assetGraph = await loadAssetGraph(cacheInfo, requestTracker, cache);

  function getSubRequests(id: NodeId) {
    return requestTracker.graph
      .getNodeIdsConnectedFrom(id, requestGraphEdgeTypes.subrequest)
      .map(n => nullthrows(requestTracker.graph.getNode(n)));
  }

  // Load graphs by finding the main subrequests and loading their results
  let bundleInfo;
  try {
    invariant(requestTracker != null, 'Expected request tracker to be loaded');
    let buildRequestId = requestTracker.graph.getNodeIdByContentKey(
      'parcel_build_request',
    );
    let buildRequestNode = nullthrows(
      requestTracker.graph.getNode(buildRequestId),
    );
    invariant(
      buildRequestNode.type === 1 && buildRequestNode.requestType === 1,
    );
    let buildRequestSubRequests = getSubRequests(buildRequestId);

    let writeBundlesRequest = buildRequestSubRequests.find(
      n => n.type === 1 && n.requestType === 11,
    );
    if (writeBundlesRequest != null) {
      invariant(writeBundlesRequest.type === 1);
      // $FlowFixMe[incompatible-cast]
      bundleInfo = (nullthrows(writeBundlesRequest.result): Map<
        ContentKey,
        PackagedBundleInfo,
      >);
    }
  } catch (e) {
    console.log('Error loading bundleInfo\n', e);
  }

  return {assetGraph, bundleGraph, requestTracker, bundleInfo, cacheInfo};
}
