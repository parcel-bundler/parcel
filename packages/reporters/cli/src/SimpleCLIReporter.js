// @flow strict-local

import type {LogLevel, ReporterEvent, ParcelOptions} from '@parcel/types';

import type {Writable} from 'stream';

import {render} from 'ink';
import {Reporter} from '@parcel/plugin';
import * as React from 'react';

import BundleReport from './BundleReport';
import {prettyError, prettifyTime} from '@parcel/utils';
import {getProgressMessage} from './utils';
import logLevels from './logLevels';

export default new Reporter({
  report(event: ReporterEvent, options: ParcelOptions) {
    _report(event, options);
  }
});

let stdout = process.stdout;
let stderr = process.stderr;

// Exported only for test
export function _setStdio(stdoutLike: Writable, stderrLike: Writable) {
  stdout = stdoutLike;
  stderr = stderrLike;
}

// Exported only for test
export function _report(event: ReporterEvent, options: ParcelOptions): void {
  let logLevelFilter = logLevels[options.logLevel || 'info'];

  switch (event.type) {
    case 'buildProgress': {
      if (logLevelFilter < logLevels.info) {
        break;
      }

      let message = getProgressMessage(event);
      if (message != null) {
        writeOut(message);
      }
      break;
    }
    case 'buildSuccess':
      if (logLevelFilter < logLevels.info) {
        break;
      }

      writeOut(`Built in ${prettifyTime(event.buildTime)}`);
      if (options.mode === 'production') {
        render(<BundleReport bundleGraph={event.bundleGraph} />);
      }
      break;
    case 'buildFailure':
      if (logLevelFilter < logLevels.error) {
        break;
      }

      writeErr(event.error, options.logLevel);
      break;
    case 'log': {
      switch (event.level) {
        case 'warn':
        case 'error':
          if (logLevelFilter >= logLevels[event.level]) {
            writeErr(event.message, options.logLevel);
          }
          break;
        case 'info':
        case 'verbose':
        case 'progress':
        case 'success':
          if (logLevelFilter >= logLevels[event.level]) {
            writeOut(event.message);
          }
          break;
        default:
          throw new Error('Unknown log level ' + event.level);
      }
    }
  }
}

function writeOut(message: string): void {
  stdout.write(message + '\n');
}

function writeErr(message: string | Error, level: LogLevel): void {
  let error = prettyError(message, {color: false});
  // prefix with parcel: to clarify the source of errors
  writeErrLine('parcel: ' + error.message);
  if (error.stack != null && logLevels[level] >= logLevels.verbose) {
    writeErrLine(error.stack);
  }
}

function writeErrLine(message: string): void {
  stderr.write(message + '\n');
}
