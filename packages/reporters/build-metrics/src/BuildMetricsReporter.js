// @flow strict-local
import path from 'path';

import {Reporter} from '@parcel/plugin';
import {generateBundleReport} from '@parcel/utils';

export default new Reporter({
  async report(event, options) {
    if (event.type === 'buildSuccess') {
      let metricsFilePath = path.join(process.cwd(), 'parcel-metrics.json');

      let metrics = {
        buildTime: event.buildTime,
        bundles: event.bundleGraph
          ? generateBundleReport(event.bundleGraph).bundles
          : undefined
      };

      await options.outputFS.writeFile(
        metricsFilePath,
        JSON.stringify(metrics)
      );
    }
  }
});
