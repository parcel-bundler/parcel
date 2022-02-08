// @flow strict-local

import type {FilePath, PluginOptions, ReporterEvent} from '@parcel/types';

import {Reporter} from '@parcel/plugin';
import os from 'os';
import fs from 'fs';
import path from 'path';
// $FlowFixMe
import {performance} from 'perf_hooks';
import {getSentry} from '@atlassian/internal-parcel-utils';

import analytics from './analytics';

const PROGRESS_SAMPLE_RATE = 3000;

let buildStartTime;
let buildStartCpuUsage;
let userNotified;

export default (new Reporter({
  report({event, logger, options}) {
    if (event.type === 'buildStart') {
      buildStartCpuUsage = process.cpuUsage();
      buildStartTime = performance.now();
      if (!userNotified) {
        logger.info({
          message: `This internal Atlassian build of Parcel includes telemetry recording
important events that occur, such as as when builds start, progress, and end in either success or failure.

This telemetry includes information such memory and cpu usage. Details about user-triggered
errors such as syntax errors should not be included in these reports. Other errors are captured automatically.

Source code for our version of Parcel is available at https://bitbucket.org/atlassian/parcel/

Please visit #help-parcel for help or #parcel for general discussion in Slack.
`,
        });
        userNotified = true;
      }
    }

    switch (event.type) {
      case 'buildStart':
        analytics.track({
          subject: 'build',
          action: 'start',
          additionalAttributes: getAdditionalProperties(event, options),
        });
        break;
      case 'buildProgress': {
        // Don't await these.
        analytics.trackSampled(PROGRESS_SAMPLE_RATE, () => {
          let subject;
          let subjectId;
          switch (event.phase) {
            case 'resolving':
              subject = 'asset';
              subjectId = event.dependency.specifier;
              break;
            case 'transforming':
              subject = 'asset';
              subjectId = path.relative(options.projectRoot, event.filePath);
              break;
            case 'packaging':
            case 'optimizing':
              subject = 'bundle';
              subjectId = path.relative(
                options.projectRoot,
                path.join(event.bundle.target.distDir, event.bundle.name),
              );
              break;
            case 'bundling':
              subject = 'bundleGraph';
              break;
            default:
              throw new Error('Unknown event phase');
          }

          return {
            action: event.phase,
            subject,
            subjectId,
            additionalAttributes: getAdditionalProperties(event, options),
          };
        });

        break;
      }
      case 'buildSuccess':
        analytics.track({
          action: 'success',
          subject: 'build',
          subjectId: options.instanceId,
          additionalAttributes: {
            buildTime: event.buildTime,
            numChangedAssets: Array.from(event.changedAssets).length,
            ...getAdditionalProperties(event, options),
          },
        });
        break;
      case 'buildFailure': {
        const relevantDiagnostics = event.diagnostics.filter(
          // Ignore all SyntaxErrors. These are likely user errors.
          diagnostic => diagnostic.name !== 'SyntaxError',
        );

        analytics.track({
          action: 'failure',
          subject: 'build',
          subjectId: options.instanceId,
          additionalAttributes: {
            relevantDiagnostics: relevantDiagnostics.map(diagnostic => ({
              stack:
                diagnostic.stack != null
                  ? sanitizePaths(diagnostic.stack, options)
                  : null,
              message: sanitizePaths(diagnostic.message, options),
            })),
            ...getAdditionalProperties(event, options),
          },
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

const projectRootToProjectName: Map<FilePath, ?string> = new Map();
function getAdditionalProperties(event: ReporterEvent, options: PluginOptions) {
  const cpuUsage =
    event.type === 'buildStart' ? null : process.cpuUsage(buildStartCpuUsage);
  const timeSinceBuildStart =
    event.type === 'buildStart' ? 0 : performance.now() - buildStartTime;

  let projectName;
  if (projectRootToProjectName.has(options.projectRoot)) {
    projectName = projectRootToProjectName.get(options.projectRoot);
  } else {
    try {
      projectName = JSON.parse(
        fs.readFileSync(path.join(options.projectRoot, 'package.json'), 'utf8'),
      ).name;
    } catch {
      // leave undefined on failure
    }
    projectRootToProjectName.set(options.projectRoot, projectName);
  }

  return {
    buildId: options.instanceId,
    projectName,
    timeSinceBuildStart,
    userCpuUsage: cpuUsage?.user,
    systemCpuUsage: cpuUsage?.system,
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
