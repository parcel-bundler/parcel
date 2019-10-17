// @flow strict-local

import type {LogLevel, ReporterEvent, PluginOptions} from '@parcel/types';
import type {Diagnostic} from '@parcel/diagnostic';

import type {Writable} from 'stream';

import {render} from 'ink';
import {Reporter} from '@parcel/plugin';
import * as React from 'react';

import BundleReport from './BundleReport';
import {prettyError, prettifyTime} from '@parcel/utils';
import {getProgressMessage} from './utils';
import logLevels from './logLevels';
import formatCodeFrame from './formatCodeFrame';

export default new Reporter({
  report(event, options) {
    _report(event, options);
  }
});

let stdout = process.stdout;
let stderr = process.stderr;
let wroteServerInfo = false;

// Exported only for test
export function _setStdio(stdoutLike: Writable, stderrLike: Writable) {
  stdout = stdoutLike;
  stderr = stderrLike;
}

// Exported only for test
export function _report(event: ReporterEvent, options: PluginOptions): void {
  let logLevelFilter = logLevels[options.logLevel || 'info'];

  switch (event.type) {
    case 'buildStart': {
      if (options.serve && !wroteServerInfo) {
        writeOut(
          `Server running at ${
            options.serve.https ? 'https' : 'http'
          }://${options.serve.host ?? 'localhost'}:${options.serve.port}`
        );
        wroteServerInfo = true;
      }
      break;
    }
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
        case 'success':
        case 'progress':
          writeOut(event.message);
          break;
        case 'verbose':
        case 'warn':
        case 'error':
        case 'info':
          writeDiagnostic(event.diagnostic);
          break;
        default:
          throw new Error('Unknown log level ' + event.level);
      }
    }
  }
}

function writeDiagnostic(diagnostic: Diagnostic) {
  let {origin, message, stack, codeframe, hints, filename} = diagnostic;

  writeOut(`${origin}: ${message}`);
  if (typeof stack === 'string') {
    writeOut(stack);
  }
  if (codeframe !== undefined) {
    let highlight = Array.isArray(codeframe.codeHighlights)
      ? codeframe.codeHighlights[0]
      : codeframe.codeHighlights;

    if (highlight) {
      let formattedCodeFrame = formatCodeFrame(codeframe);

      writeOut(
        `${typeof filename !== 'string' ? '' : filename}@${
          highlight.start.line
        }:${highlight.start.column}`
      );
      writeOut(formattedCodeFrame);
    }
  }
  if (Array.isArray(hints) && hints.length) {
    for (let hint of hints) {
      writeOut(hint);
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
