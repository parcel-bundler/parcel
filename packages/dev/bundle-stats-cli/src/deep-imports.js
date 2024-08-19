// @flow
/* eslint-disable monorepo/no-internal-import */
import typeof {loadGraphs} from '@atlaspack/query/src/index.js';
import typeof {getBundleStats} from '@atlaspack/reporter-bundle-stats/src/BundleStatsReporter';
import typeof {PackagedBundle as PackagedBundleClass} from '@atlaspack/core/src/public/Bundle';

module.exports = ((process.env.ATLASPACK_BUILD_ENV === 'production'
  ? {
      // Split up require specifier to outsmart packages/dev/babel-register/babel-plugin-module-translate.js
      // $FlowFixMe(unsupported-syntax)
      loadGraphs: require('@atlaspack/query' + '/lib/index.js').loadGraphs,
      // $FlowFixMe(unsupported-syntax)
      getBundleStats: require('@atlaspack/reporter-bundle-stats' +
        '/lib/BundleStatsReporter.js').getBundleStats,
      // $FlowFixMe(unsupported-syntax)
      PackagedBundleClass: require('@atlaspack/core' + '/lib/public/Bundle.js')
        .PackagedBundle,
    }
  : {
      loadGraphs: require('@atlaspack/query/src/index.js').loadGraphs,
      getBundleStats:
        require('@atlaspack/reporter-bundle-stats/src/BundleStatsReporter.js')
          .getBundleStats,
      PackagedBundleClass: require('@atlaspack/core/src/public/Bundle.js')
        .PackagedBundle,
    }): {|
  loadGraphs: loadGraphs,
  getBundleStats: getBundleStats,
  PackagedBundleClass: PackagedBundleClass,
|});
