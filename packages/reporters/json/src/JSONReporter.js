// @flow strict-local

import type {
  BuildProgressEvent,
  LogEvent,
  ParcelOptions,
  ReporterEvent
} from '@parcel/types';
import type {BundleReport} from '@parcel/utils';

import {Reporter} from '@parcel/plugin';
import {generateBundleReport} from '@parcel/utils';

/* eslint-disable no-console */
const writeToStdout = makeWriter(console.log);
const writeToStderr = makeWriter(console.error);
/* eslint-enable no-console */

const LOG_LEVELS = {
  none: 0,
  error: 1,
  warn: 2,
  info: 3,
  progress: 3,
  success: 3,
  verbose: 4
};

export default new Reporter({
  report(event: ReporterEvent, options: ParcelOptions) {
    let logLevelFilter = options.logLevel || 'info';

    switch (event.type) {
      case 'buildStart':
        if (LOG_LEVELS[logLevelFilter] >= LOG_LEVELS.info) {
          writeToStdout({type: 'buildStart'}, logLevelFilter);
        }
        break;
      case 'buildFailure':
        if (LOG_LEVELS[logLevelFilter] >= LOG_LEVELS.error) {
          writeToStderr(
            {type: 'buildFailure', message: event.error.message},
            logLevelFilter
          );
        }
        break;
      case 'buildProgress':
        if (LOG_LEVELS[logLevelFilter] >= LOG_LEVELS.progress) {
          let jsonEvent = progressEventToJSONEvent(event);
          if (jsonEvent != null) {
            writeToStdout(jsonEvent, logLevelFilter);
          }
        }
        break;
      case 'buildSuccess':
        if (LOG_LEVELS[logLevelFilter] >= LOG_LEVELS.success) {
          writeToStdout(
            {
              type: 'buildSuccess',
              buildTime: event.buildTime,
              bundles: event.bundleGraph
                ? generateBundleReport(event.bundleGraph).bundles
                : undefined
            },
            logLevelFilter
          );
        }
        break;
      case 'log':
        writeLogEvent(event, logLevelFilter);
    }
  }
});

function makeWriter(
  write: string => mixed
): (JSONReportEvent, $Keys<typeof LOG_LEVELS>) => void {
  return (
    event: JSONReportEvent,
    logLevelFilter: $Keys<typeof LOG_LEVELS>
  ): void => {
    let stringified;
    try {
      stringified = JSON.stringify(event);
    } catch (err) {
      // This should never happen so long as JSONReportEvent is easily serializable
      if (LOG_LEVELS[logLevelFilter] >= LOG_LEVELS.error) {
        writeToStderr(
          {type: 'log', level: 'error', message: err},
          logLevelFilter
        );
      }
      return;
    }

    write(stringified);
  };
}

function writeLogEvent(
  event: LogEvent,
  logLevelFilter: $Keys<typeof LOG_LEVELS>
): void {
  if (LOG_LEVELS[logLevelFilter] < LOG_LEVELS[event.level]) {
    return;
  }
  switch (event.level) {
    case 'info':
    case 'progress':
    case 'success':
    case 'verbose':
      writeToStdout(event, logLevelFilter);
      break;
    case 'warn':
    case 'error':
      writeToStderr(
        {
          type: 'log',
          level: event.level,
          message:
            typeof event.message === 'string'
              ? event.message
              : event.message.message
        },
        logLevelFilter
      );
      break;
  }
}

function progressEventToJSONEvent(
  progressEvent: BuildProgressEvent
): ?JSONProgressEvent {
  switch (progressEvent.phase) {
    case 'transforming':
      return {
        type: 'buildProgress',
        phase: 'transforming',
        filePath: progressEvent.request.filePath
      };
    case 'bundling':
      return {
        type: 'buildProgress',
        phase: 'bundling'
      };
    case 'optimizing':
    case 'packaging':
      return {
        type: 'buildProgress',
        phase: progressEvent.phase,
        bundleFilePath: progressEvent.bundle.filePath
      };
  }
}

type JSONReportEvent =
  | {|
      +type: 'log',
      +level: 'info' | 'success' | 'verbose' | 'progress' | 'warn' | 'error',
      +message: string
    |}
  | {|+type: 'buildStart'|}
  | {|+type: 'buildFailure', message: string|}
  | {|
      +type: 'buildSuccess',
      buildTime: number,
      bundles?: $PropertyType<BundleReport, 'bundles'>
    |}
  | JSONProgressEvent;

type JSONProgressEvent =
  | {|
      +type: 'buildProgress',
      phase: 'transforming',
      filePath: string
    |}
  | {|+type: 'buildProgress', phase: 'bundling'|}
  | {|
      +type: 'buildProgress',
      +phase: 'packaging' | 'optimizing',
      bundleFilePath?: string
    |};
