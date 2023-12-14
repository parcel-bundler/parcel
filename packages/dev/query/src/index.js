// @flow strict-local
/* eslint-disable no-console, monorepo/no-internal-import */
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

let cacheInfo: Map<string, Array<string | number>> = new Map();

function filesByTypeAndModifiedTime(cacheDir: string) {
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

export async function loadRequestTracker(
  requestGraphFiles: string[],
  cache: LMDBCache,
): Promise<{|
  requestTracker: ?RequestTracker,
|}> {
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
      return requestTracker;
    } catch (e) {
      console.log('Error loading Request Graph\n', e);
    }
  }
}

export async function loadBundleGraph(
  bundleGraphFiles: string[],
  cache: LMDBCache,
): Promise<{|
  bundleGraph: ?BundleGraph,
|}> {
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
      return bundleGraph;
    } catch (e) {
      console.log('Error loading Bundle Graph\n', e);
    }
  }
}

export async function loadAssetGraph(
  assetGraphFiles: string[],
  cache: LMDBCache,
): Promise<{|
  assetGraph: ?AssetGraph,
|}> {
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
      return assetGraph;
    } catch (e) {
      console.log('Error loading Asset Graph\n', e);
    }
  }
}

export async function loadBundleInfo(requestTracker: RequestTracker): Promise<{|
  bundleInfo: ?Map<ContentKey, PackagedBundleInfo>,
|}> {
  function getSubRequests(id: NodeId) {
    return requestTracker.graph
      .getNodeIdsConnectedFrom(id, requestGraphEdgeTypes.subrequest)
      .map(n => nullthrows(requestTracker.graph.getNode(n)));
  }

  // Load graphs by finding the main subrequests and loading their results
  let bundleInfo;
  try {
    invariant(requestTracker);
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
      return bundleInfo;
    }
  } catch (e) {
    console.log('Error loading bundleInfo\n', e);
  }
}

export async function loadGraphs(cacheDir: string): Promise<{|
  assetGraph: ?AssetGraph,
  bundleGraph: ?BundleGraph,
  requestTracker: ?RequestTracker,
  bundleInfo: ?Map<ContentKey, PackagedBundleInfo>,
  cacheInfo: ?Map<string, Array<string | number>>,
|}> {
  let {requestGraphFiles, bundleGraphFiles, assetGraphFiles} =
    filesByTypeAndModifiedTime(cacheDir);
  const cache = new LMDBCache(cacheDir);

  let requestTracker = loadRequestTracker(requestGraphFiles, cache);
  let bundleGraph = loadBundleGraph(bundleGraphFiles, cache);
  let assetGraph = loadAssetGraph(assetGraphFiles, cache);

  requestTracker = await requestTracker;
  let bundleInfo = loadBundleInfo(requestTracker);
  bundleGraph = await bundleGraph;
  assetGraph = await assetGraph;

  bundleInfo = await bundleInfo;

  return {assetGraph, bundleGraph, requestTracker, bundleInfo, cacheInfo};
}
