// @flow
/* eslint-disable monorepo/no-internal-import */
import typeof AssetGraph from '@atlaspack/core/src/AssetGraph.js';
import typeof BundleGraph, {
  bundleGraphEdgeTypes,
} from '@atlaspack/core/src/BundleGraph.js';
import typeof RequestTracker, {
  RequestGraph,
  readAndDeserializeRequestGraph,
} from '@atlaspack/core/src/RequestTracker.js';
import typeof {requestGraphEdgeTypes} from '@atlaspack/core/src/RequestTracker.js';
import typeof {LMDBCache} from '@atlaspack/cache/src/LMDBCache.js';
import typeof {Priority} from '@atlaspack/core/src/types.js';
import typeof {fromProjectPathRelative} from '@atlaspack/core/src/projectPath.js';

const v =
  process.env.ATLASPACK_BUILD_ENV === 'production'
    ? {
        // Split up require specifier to outsmart packages/dev/babel-register/babel-plugin-module-translate.js
        // $FlowFixMe(unsupported-syntax)
        AssetGraph: require('@atlaspack/core' + '/lib/AssetGraph.js').default,
        // $FlowFixMe(unsupported-syntax)
        BundleGraph: require('@atlaspack/core' + '/lib/BundleGraph.js'),
        // $FlowFixMe(unsupported-syntax)
        RequestTracker: require('@atlaspack/core' + '/lib/RequestTracker.js'),
        // $FlowFixMe(unsupported-syntax)
        LMDBCache: require('@atlaspack/cache' + '/lib/LMDBCache.js').LMDBCache,
        // $FlowFixMe(unsupported-syntax)
        Priority: require('@atlaspack/core' + '/lib/types.js').Priority,
        // $FlowFixMe(unsupported-syntax)
        fromProjectPathRelative: require('@atlaspack/core' +
          '/lib/projectPath.js').fromProjectPathRelative,
      }
    : {
        AssetGraph: require('@atlaspack/core/src/AssetGraph.js').default,
        BundleGraph: require('@atlaspack/core/src/BundleGraph.js'),
        RequestTracker: require('@atlaspack/core/src/RequestTracker.js'),
        LMDBCache: require('@atlaspack/cache/src/LMDBCache.js').LMDBCache,
        Priority: require('@atlaspack/core/src/types.js').Priority,
        fromProjectPathRelative: require('@atlaspack/core/src/projectPath.js')
          .fromProjectPathRelative,
      };

module.exports = (v: {|
  AssetGraph: AssetGraph,
  BundleGraph: {
    default: BundleGraph,
    bundleGraphEdgeTypes: bundleGraphEdgeTypes,
    ...
  },
  RequestTracker: {
    default: RequestTracker,
    readAndDeserializeRequestGraph: readAndDeserializeRequestGraph,
    RequestGraph: RequestGraph,
    requestGraphEdgeTypes: requestGraphEdgeTypes,
    ...
  },
  LMDBCache: LMDBCache,
  Priority: Priority,
  fromProjectPathRelative: fromProjectPathRelative,
|});
