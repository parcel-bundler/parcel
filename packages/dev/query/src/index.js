// @flow strict-local
/* eslint-disable monorepo/no-internal-import */
import type {PackagedBundleInfo} from '@parcel/core/src/types';

import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import nullthrows from 'nullthrows';
import invariant from 'assert';

import AssetGraph from '@parcel/core/src/AssetGraph.js';
import BundleGraph from '@parcel/core/src/BundleGraph.js';
import RequestTracker, {RequestGraph} from '@parcel/core/src/RequestTracker.js';

export function loadGraphs(cacheDir: string): {|
  assetGraph: ?AssetGraph,
  bundleGraph: ?BundleGraph,
  requestTracker: ?RequestTracker,
|} {
  function filesBySize() {
    let files = fs
      .readdirSync(cacheDir)
      .map(f => [
        path.join(cacheDir, f),
        fs.statSync(path.join(cacheDir, f)).size,
      ]);

    files.sort(([, a], [, b]) => b - a);

    return files.map(([f]) => f);
  }

  let bundleGraph, assetGraph, requestTracker;
  for (let f of filesBySize()) {
    if (bundleGraph && assetGraph && requestTracker) break;
    if (path.extname(f) !== '') continue;
    try {
      let obj = v8.deserialize(fs.readFileSync(f));
      if (obj.assetGraph != null && obj.assetGraph.value.hash != null) {
        assetGraph = AssetGraph.deserialize(obj.assetGraph.value);
      } else if (obj.bundleGraph != null) {
        bundleGraph = BundleGraph.deserialize(obj.bundleGraph.value);
      } else if (obj['$$type']?.endsWith('RequestGraph')) {
        requestTracker = new RequestTracker({
          graph: RequestGraph.deserialize(obj.value),
          // $FlowFixMe
          farm: null,
          // $FlowFixMe
          options: null,
        });
      }
    } catch (e) {
      // noop
    }
  }

  return {assetGraph, bundleGraph, requestTracker};
}

export function getBundleInfo(
  requestTracker: RequestTracker,
): Map<string, PackagedBundleInfo> {
  // let id = nullthrows(
  //   [...requestTracker.graph._contentKeyToNodeId.keys()].find(k =>
  //     k.startsWith('write_bundles:'),
  //   ),
  // );
  // let v = nullthrows(
  //   await requestTracker.getRequestResult<Map<string, PackagedBundleInfo>>(id),
  // );

  // Hack to make getRequestResult sync
  let node = nullthrows(
    [...requestTracker.graph.nodes.values()].find(
      n => n.type === 'request' && n.value.type === 'write_bundles_request',
    ),
  );
  invariant(
    node.type === 'request' && node.value.type === 'write_bundles_request',
  );
  // $FlowFixMe[incompatible-type]
  let v: Map<string, PackagedBundleInfo> = node.value.result;
  return v;
}
