// @flow strict-local
import path from 'path';

import {Reporter} from '@parcel/plugin';
import {generateBundleReport} from '@parcel/utils';

let timings = {};
let lastPhase;

export default new Reporter({
  async report({event, options}) {
    if (event.type === 'buildProgress') {
      timings[event.phase] = Date.now();
      if (lastPhase && lastPhase !== event.phase) {
        timings[lastPhase] = Date.now() - timings[lastPhase];
      }
      lastPhase = event.phase;
    }

    if (event.type === 'buildSuccess') {
      timings[lastPhase] = Date.now() - timings[lastPhase];
      let metricsFilePath = path.join(process.cwd(), 'parcel-metrics.json');

      let metrics = {
        phaseTimings: timings,
        buildTime: event.buildTime,
        bundles: event.bundleGraph
          ? generateBundleReport(event.bundleGraph).bundles
          : undefined,
      };

      await options.outputFS.writeFile(
        metricsFilePath,
        JSON.stringify(metrics),
      );
    }
  },
});
