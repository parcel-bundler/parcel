// @flow
/* eslint-disable monorepo/no-internal-import */
import typeof AssetGraph from '@parcel/core/src/AssetGraph.js';
import typeof BundleGraph, {
  bundleGraphEdgeTypes,
} from '@parcel/core/src/BundleGraph.js';
import type {BundleGraphEdgeType} from '@parcel/core/src/BundleGraph.js';
import typeof RequestTracker, {
  RequestGraph,
  requestTypes,
} from '@parcel/core/src/RequestTracker.js';
import {typeof requestGraphEdgeTypes} from '@parcel/core/src/RequestTracker.js';
import {typeof LMDBCache} from '@parcel/cache/src/LMDBCache.js';
import {typeof Priority} from '@parcel/core/src/types.js';
import {typeof fromProjectPathRelative} from '@parcel/core/src/projectPath.js';
import type {
  AssetGraphNode,
  BundleGraphNode,
  PackagedBundleInfo,
} from '@parcel/core/src/types.js';

module.exports = ((process.env.PARCEL_BUILD_ENV === 'production'
  ? {
      // Split up require specifier to outsmart packages/dev/babel-register/babel-plugin-module-translate.js
      // $FlowFixMe(unsupported-syntax)
      AssetGraph: require('@parcel/core' + '/lib/AssetGraph.js').default,
      // $FlowFixMe(unsupported-syntax)
      BundleGraph: require('@parcel/core' + '/lib/BundleGraph.js'),
      // $FlowFixMe(unsupported-syntax)
      RequestTracker: require('@parcel/core' + '/lib/RequestTracker.js'),
      // $FlowFixMe(unsupported-syntax)
      LMDBCache: require('@parcel/cache' + '/lib/LMDBCache.js').LMDBCache,
      // $FlowFixMe(unsupported-syntax)
      Types: require('@parcel/core' + '/lib/types.js'),
      // $FlowFixMe(unsupported-syntax)
      fromProjectPathRelative: require('@parcel/core' + '/lib/projectPath.js')
        .fromProjectPathRelative,
    }
  : {
      AssetGraph: require('@parcel/core/src/AssetGraph.js').default,
      // $FlowFixMe(incompatible-cast)
      BundleGraph: require('@parcel/core/src/BundleGraph.js'),
      RequestTracker: require('@parcel/core/src/RequestTracker.js'),
      LMDBCache: require('@parcel/cache/src/LMDBCache.js').LMDBCache,
      // $FlowFixMe(incompatible-cast)
      Types: require('@parcel/core/src/types.js'),
      fromProjectPathRelative: require('@parcel/core/src/projectPath.js')
        .fromProjectPathRelative,
    }): {|
  AssetGraph: AssetGraph,
  BundleGraph: {
    default: BundleGraph,
    bundleGraphEdgeTypes: bundleGraphEdgeTypes,
    BundleGraphEdgeType: BundleGraphEdgeType,
    ...
  },
  RequestTracker: {
    default: RequestTracker,
    RequestGraph: RequestGraph,
    requestGraphEdgeTypes: requestGraphEdgeTypes,
    requestTypes: requestTypes,
    ...
  },
  LMDBCache: LMDBCache,
  Types: {
    Priority: Priority,
    AssetGraphNode: AssetGraphNode,
    BundleGraphNode: BundleGraphNode,
    PackagedBundleInfo: PackagedBundleInfo,
    ...
  },
  fromProjectPathRelative: fromProjectPathRelative,
|});
