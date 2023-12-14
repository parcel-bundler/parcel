// @flow strict-local
/* eslint-disable monorepo/no-internal-import */
import type {ContentKey, NodeId} from '@parcel/graph';
import type {PackagedBundleInfo} from '@parcel/core/src/types';

import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import nullthrows from 'nullthrows';
import invariant from 'assert';

const {
  AssetGraph,
  BundleGraph: {default: BundleGraph},
  RequestTracker: {
    default: RequestTracker,
    RequestGraph,
    requestGraphEdgeTypes,
  },
  LMDBCache,
} = require('./deep-imports.js');

export async function loadGraphs(cacheDir: string): Promise<{|
  assetGraph: ?AssetGraph,
  bundleGraph: ?BundleGraph,
  requestTracker: ?RequestTracker,
  bundleInfo: ?Map<ContentKey, PackagedBundleInfo>,
  cacheInfo: ?Map<string, Array<string | number>>,
|}> {
  function filesByTypeAndModifiedTime() {
    let files = fs.readdirSync(cacheDir);

    let requestGraphFiles = [];
    let bundleGraphFiles = [];
    let assetGraphFiles = [];

    files.forEach(f => {
      if (f.endsWith('-0')) {
        let stat = fs.statSync(path.join(cacheDir, f));
        let info = [path.join(cacheDir, f), stat.size, stat.mtime];

        if (f.endsWith('RequestGraph-0')) {
          requestGraphFiles.push(info);
        } else if (f.endsWith('BundleGraph-0')) {
          bundleGraphFiles.push(info);
        } else if (f.endsWith('AssetGraph-0')) {
          assetGraphFiles.push(info);
        }
      }
    });

    requestGraphFiles.sort(([, , aTime], [, , bTime]) => bTime - aTime);
    bundleGraphFiles.sort(([, , aTime], [, , bTime]) => bTime - aTime);
    assetGraphFiles.sort(([, , aTime], [, , bTime]) => bTime - aTime);

    return {
      requestGraphFiles: requestGraphFiles.map(([f]) => f),
      bundleGraphFiles: bundleGraphFiles.map(([f]) => f),
      assetGraphFiles: assetGraphFiles.map(([f]) => f),
    };
  }

  let cacheInfo: Map<string, Array<string | number>> = new Map();

  let {requestGraphFiles, bundleGraphFiles, assetGraphFiles} =
    filesByTypeAndModifiedTime();
  const cache = new LMDBCache(cacheDir);

  // Get requestTracker
  let requestTracker;
  if (requestGraphFiles.length > 0) {
    try {
      let file = await cache.getLargeBlob(
        path.basename(requestGraphFiles[0]).slice(0, -'-0'.length),
      );

      let timeToDeserialize = Date.now();
      let obj = v8.deserialize(file);
      timeToDeserialize = Date.now() - timeToDeserialize;

      invariant(obj['$$type']?.endsWith('RequestGraph'));
      let date = Date.now();
      requestTracker = new RequestTracker({
        graph: RequestGraph.deserialize(obj.value),
        // $FlowFixMe
        farm: null,
        // $FlowFixMe
        options: null,
      });
      timeToDeserialize += Date.now() - date;
      cacheInfo.set('RequestGraph', [Buffer.byteLength(file)]);
      cacheInfo.get('RequestGraph')?.push(timeToDeserialize);
    } catch (e) {
      throw new Error('Issue with identifying Request Graph');
    }
  }

  // Get bundleGraph
  let bundleGraph;
  if (bundleGraphFiles.length > 0) {
    try {
      let file = await cache.getLargeBlob(
        path.basename(bundleGraphFiles[0]).slice(0, -'-0'.length),
      );

      let timeToDeserialize = Date.now();
      let obj = v8.deserialize(file);
      invariant(obj.bundleGraph != null);
      bundleGraph = BundleGraph.deserialize(obj.bundleGraph.value);
      timeToDeserialize = Date.now() - timeToDeserialize;

      cacheInfo.set('BundleGraph', [Buffer.byteLength(file)]);
      cacheInfo.get('BundleGraph')?.push(timeToDeserialize);
    } catch (e) {
      throw new Error('Issue with identifying Bundle Graph');
    }
  }

  // Get assetGraph
  let assetGraph;
  if (assetGraphFiles.length > 0) {
    try {
      let file = await cache.getLargeBlob(
        path.basename(assetGraphFiles[0]).slice(0, -'-0'.length),
      );

      let timeToDeserialize = Date.now();
      let obj = v8.deserialize(file);
      invariant(obj.assetGraph != null);
      assetGraph = AssetGraph.deserialize(obj.assetGraph.value);
      timeToDeserialize = Date.now() - timeToDeserialize;

      cacheInfo.set('AssetGraph', [Buffer.byteLength(file)]);
      cacheInfo.get('AssetGraph')?.push(timeToDeserialize);
    } catch (e) {
      throw new Error('Issue with identifying Asset Graph');
    }
  }

  function getSubRequests(id: NodeId) {
    return requestTracker.graph
      .getNodeIdsConnectedFrom(id, requestGraphEdgeTypes.subrequest)
      .map(n => nullthrows(requestTracker.graph.getNode(n)));
  }

  // Load graphs by finding the main subrequests and loading their results
  let bundleInfo;
  invariant(requestTracker);
  let buildRequestId = requestTracker.graph.getNodeIdByContentKey(
    'parcel_build_request',
  );
  let buildRequestNode = nullthrows(
    requestTracker.graph.getNode(buildRequestId),
  );
  invariant(buildRequestNode.type === 1 && buildRequestNode.requestType === 1);
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

  return {assetGraph, bundleGraph, requestTracker, bundleInfo, cacheInfo};
}

async function loadLargeBlobRequestRequest(cache, node, cacheInfo) {
  invariant(node.type === 1);

  let cachedFile = await cache.getLargeBlob(nullthrows(node.resultCacheKey));

  let TTD = Date.now();
  let result = v8.deserialize(cachedFile);
  TTD = Date.now() - TTD;

  if (node.requestType === 2) {
    cacheInfo.get('BundleGraph')?.push(cachedFile.byteLength); //Add size
    cacheInfo.get('BundleGraph')?.push(TTD);
  }

  if (node.requestType === 3) {
    cacheInfo.get('AssetGraph')?.push(cachedFile.byteLength);
    cacheInfo.get('AssetGraph')?.push(TTD);
  }

  return result;
}
