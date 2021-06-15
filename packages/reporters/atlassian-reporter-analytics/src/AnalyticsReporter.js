// @flow strict-local

import type {PluginOptions, ReporterEvent} from '@parcel/types';

import {Reporter} from '@parcel/plugin';
import os from 'os';
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

export default (new Reporter({
  report({event, logger, options}) {
    if (event.type === 'buildStart') {
      buildStartCpuUsage = process.cpuUsage();
      buildStartTime = performance.now();
      buildId = uuid();
      if (!userNotified) {
        logger.info({
          message: `This internal Atlassian build of Parcel includes telemetry recording
important events that occur, such as as when builds start, progress, and end in either success or failure.

This telemetry includes information such memory and cpu usage. Details about user-triggered
errors such as syntax errors should not be included in these reports. Other errors are captured automatically.

Source code for our version of Parcel is available at https://bitbucket.org/atlassian/parcel/

Please visit #parcel-frontbucket (for Frontbucket) or #parcel (for general discussion) in Slack
to send us your feedback or questions!
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
                filePath = path.join(
                  event.bundle.target.distDir,
                  event.bundle.name,
                );
                bundle = {
                  filePath: path.relative(options.projectRoot, filePath),
                  name: event.bundle.name,
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
          relevantDiagnostics: relevantDiagnostics.map(diagnostic => ({
            filePath:
              diagnostic.filePath != null
                ? sanitizePaths(diagnostic.filePath, options)
                : null,
            stack:
              diagnostic.stack != null
                ? sanitizePaths(diagnostic.stack, options)
                : null,
            message: sanitizePaths(diagnostic.message, options),
          })),
          ...getAdditionalProperties(event, options),
        });

        for (const diagnostic of relevantDiagnostics) {
          const stack = diagnostic.stack;
          const message = sanitizePaths(diagnostic.message, options);
          if (stack != null) {
            let err = new Error(message);
            err.stack = sanitizePaths(stack, options);
            getSentry().captureException(err);
          }
        }
        break;
      }
    }
  },
}): Reporter);

function getAdditionalProperties(event: ReporterEvent, options: PluginOptions) {
  return {
    buildId,
    timeSinceBuildStart:
      event.type === 'buildStart' ? 0 : performance.now() - buildStartTime,
    cpuUsageSinceBuildStart:
      event.type === 'buildStart' ? null : process.cpuUsage(buildStartCpuUsage),
    mode: options.mode,
    serve: Boolean(options.serveOptions),
  };
}

const homedir = os.userInfo().homedir;
function sanitizePaths(str: string, options: PluginOptions): string {
  return str
    .replace(new RegExp(options.projectRoot, 'g'), '[PROJECT_ROOT]')
    .replace(new RegExp(homedir, 'g'), '[HOMEDIR]');
}
