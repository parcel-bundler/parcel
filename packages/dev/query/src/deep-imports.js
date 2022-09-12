// @flow
/* eslint-disable monorepo/no-internal-import */
import typeof AssetGraph from '@parcel/core/src/AssetGraph.js';
import typeof BundleGraph from '@parcel/core/src/BundleGraph.js';
import typeof RequestTracker, {
  RequestGraph,
} from '@parcel/core/src/RequestTracker.js';
import {typeof requestGraphEdgeTypes} from '@parcel/core/src/RequestTracker.js';

module.exports = ((process.env.PARCEL_BUILD_ENV === 'production'
  ? {
      AssetGraph: require('@parcel/core/lib/AssetGraph.js').default,
      BundleGraph: require('@parcel/core/lib/BundleGraph.js').default,
      RequestTracker: require('@parcel/core/lib/RequestTracker.js'),
    }
  : {
      AssetGraph: require('@parcel/core/src/AssetGraph.js').default,
      BundleGraph: require('@parcel/core/src/BundleGraph.js').default,
      RequestTracker: require('@parcel/core/src/RequestTracker.js'),
    }): {|
  AssetGraph: AssetGraph,
  BundleGraph: BundleGraph,
  RequestTracker: {
    default: RequestTracker,
    RequestGraph: RequestGraph,
    requestGraphEdgeTypes: requestGraphEdgeTypes,
    ...
  },
|});
