// @flow strict-local

import type {PluginOptions, ReporterEvent} from '@parcel/types';

import {Reporter} from '@parcel/plugin';
import path from 'path';
// $FlowFixMe
import uuid from 'uuid/v4';
// $FlowFixMe
import {performance} from 'perf_hooks';
import {getSentry} from '@atlassian/internal-parcel-utils';

import analytics from './analytics';

const PROGRESS_SAMPLE_RATE = 3000;

let buildStartTime;
let buildStartCpuUsage;
let buildId;
let userNotified;

export default new Reporter({
  report({event, logger, options}) {
    if (event.type === 'buildStart') {
      buildStartCpuUsage = process.cpuUsage();
      buildStartTime = performance.now();
      buildId = uuid();
      if (!userNotified) {
        logger.info({
          message: `This internal Atlassian build of Parcel includes telemetry recording
important events that occur, such as as when builds start, progress, and end in either success or failure.

This telemetry includes information such as your os username (staffid), memory and cpu usage,
and when events occurred.

Details about user-triggered errors such as syntax errors should not be included in these reports.
Other errors are captured automatically.

Source code for our version of Parcel is available at https://staging.bb-inf.net/padmaia/parcel/src/master/
`,
        });
        userNotified = true;
      }
    }

    switch (event.type) {
      case 'buildStart':
        analytics.track('buildStart', getAdditionalProperties(event, options));
        break;
      case 'buildProgress': {
        // Don't await these.
        analytics.trackSampled(
          event.type,
          () => {
            let filePath = null;
            let bundle = null;
            switch (event.phase) {
              case 'transforming':
                filePath = event.filePath;
                break;
              case 'packaging':
              case 'optimizing':
                filePath = event.bundle.filePath;
                bundle = {
                  filePath: path.relative(
                    options.projectRoot,
                    event.bundle.filePath,
                  ),
                  name: event.bundle.name,
                  stats: event.bundle.stats,
                };
            }

            return {
              phase: event.phase,
              filePath:
                filePath != null
                  ? path.relative(options.projectRoot, filePath)
                  : null,
              bundle,
              ...getAdditionalProperties(event, options),
            };
          },
          PROGRESS_SAMPLE_RATE,
        );

        break;
      }
      case 'buildSuccess':
        analytics.track(event.type, {
          buildTime: event.buildTime,
          numChangedAssets: Array.from(event.changedAssets).length,
          ...getAdditionalProperties(event, options),
        });
        break;
      case 'buildFailure': {
        const relevantDiagnostics = event.diagnostics.filter(
          // Ignore all SyntaxErrors. These are likely user errors.
          diagnostic => diagnostic.name !== 'SyntaxError',
        );

        analytics.track(event.type, {
          relevantDiagnostics,
          ...getAdditionalProperties(event, options),
        });

        if (process.env.PARCEL_BUILD_ENV === 'production') {
          for (const diagnostic of relevantDiagnostics) {
            if (diagnostic.stack != null) {
              let err = new Error(diagnostic.message);
              err.stack = diagnostic.stack;
              getSentry().captureException(err);
            }
          }
        }
        break;
      }
    }
  },
});

function getAdditionalProperties(event: ReporterEvent, options: PluginOptions) {
  return {
    buildId,
    timeSinceBuildStart:
      event.type === 'buildStart' ? 0 : performance.now() - buildStartTime,
    cpuUsageSinceBuildStart:
      event.type === 'buildStart' ? null : process.cpuUsage(buildStartCpuUsage),
    disableCache: options.disableCache,
    projectRoot: path.dirname(options.projectRoot),
    mode: options.mode,
    minify: options.minify,
    scopeHoist: options.scopeHoist,
    sourceMaps: options.sourceMaps,
    serve: Boolean(options.serve),
  };
}
