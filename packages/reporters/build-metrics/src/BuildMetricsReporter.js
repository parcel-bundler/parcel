// @flow strict-local
import path from 'path';

import {Reporter} from '@atlaspack/plugin';
import {generateBuildMetrics} from '@atlaspack/utils';

type TimingValue = {|
  timings: {[key: string]: number, ...},
  lastPhase: string,
|};

let timingsMap = new Map();
const getValue = (instanceId: string): TimingValue => {
  if (!timingsMap.has(instanceId)) {
    timingsMap.set(instanceId, {
      timings: {},
      lastPhase: 'resolving',
    });
  }

  // $FlowFixMe
  return timingsMap.get(instanceId);
};

export default (new Reporter({
  async report({event, options}) {
    if (event.type === 'buildProgress') {
      let value = getValue(options.instanceId);

      value.timings[event.phase] = Date.now();
      if (value.lastPhase !== event.phase) {
        value.timings[value.lastPhase] =
          Date.now() - value.timings[value.lastPhase];
      }
      value.lastPhase = event.phase;
    } else if (event.type === 'buildSuccess') {
      let value = getValue(options.instanceId);

      value.timings[value.lastPhase] =
        Date.now() - value.timings[value.lastPhase];
      let metricsFilePath = path.join(
        options.projectRoot,
        'atlaspack-metrics.json',
      );

      let {bundles} = await generateBuildMetrics(
        event.bundleGraph.getBundles(),
        options.outputFS,
        options.projectRoot,
      );

      let metrics = {
        phaseTimings: value.timings,
        buildTime: event.buildTime,
        bundles: bundles.map(b => {
          return {
            filePath: b.filePath,
            size: b.size,
            time: b.time,
            largestAssets: b.assets.slice(0, 10),
            totalAssets: b.assets.length,
          };
        }),
      };

      await options.outputFS.writeFile(
        metricsFilePath,
        JSON.stringify(metrics),
      );
    }
  },
}): Reporter);
