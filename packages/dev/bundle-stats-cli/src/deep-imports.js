// @flow
/* eslint-disable monorepo/no-internal-import */
import typeof {loadGraphs} from '@parcel/query/src/index.js';
import typeof {getBundleStats} from '@parcel/reporter-bundle-stats/src/BundleStatsReporter';
import typeof {PackagedBundle as PackagedBundleClass} from '@parcel/core/src/public/Bundle';

module.exports = ((process.env.PARCEL_BUILD_ENV === 'production'
  ? {
      // Split up require specifier to outsmart packages/dev/babel-register/babel-plugin-module-translate.js
      // $FlowFixMe(unsupported-syntax)
      loadGraphs: require('@parcel/query' + '/lib/index.js').loadGraphs,
      // $FlowFixMe(unsupported-syntax)
      getBundleStats: require('@parcel/reporter-bundle-stats' +
        '/lib/BundleStatsReporter.js').getBundleStats,
      // $FlowFixMe(unsupported-syntax)
      PackagedBundleClass: require('@parcel/core' + '/lib/public/Bundle.js')
        .PackagedBundle,
    }
  : {
      loadGraphs: require('@parcel/query/src/index.js').loadGraphs,
      getBundleStats:
        require('@parcel/reporter-bundle-stats/src/BundleStatsReporter.js')
          .getBundleStats,
      PackagedBundleClass: require('@parcel/core/src/public/Bundle.js')
        .PackagedBundle,
    }): {|
  loadGraphs: loadGraphs,
  getBundleStats: getBundleStats,
  PackagedBundleClass: PackagedBundleClass,
|});
