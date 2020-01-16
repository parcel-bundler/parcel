// @flow
import type {ReporterEvent, PluginOptions} from '@parcel/types';
import type {Diagnostic} from '@parcel/diagnostic';

import {Reporter} from '@parcel/plugin';
import {prettifyTime, prettyDiagnostic, throttle} from '@parcel/utils';
import chalk from 'chalk';

import {getProgressMessage} from './utils';
import logLevels from './logLevels';
import bundleReport from './bundleReport';
import {
  writeOut,
  updateSpinner,
  persistSpinner,
  isTTY,
  resetWindow,
  persistMessage,
} from './render';
import * as emoji from './emoji';

const THROTTLE_DELAY = 100;

export default new Reporter({
  report({event, options}) {
    _report(event, options);
  },
});

let statusThrottle = throttle((message: string) => {
  updateSpinner('buildProgress', message);
}, THROTTLE_DELAY);

// Exported only for test
export function _report(event: ReporterEvent, options: PluginOptions): void {
  let logLevelFilter = logLevels[options.logLevel || 'info'];

  switch (event.type) {
    case 'buildStart': {
      if (options.serve) {
        persistMessage(
          chalk.blue.bold(
            `${emoji.info} Server running at ${
              options.serve.https ? 'https' : 'http'
            }://${options.serve.host ?? 'localhost'}:${options.serve.port}`,
          ),
        );
      }
      break;
    }
    case 'buildProgress': {
      if (logLevelFilter < logLevels.info) {
        break;
      }

      resetWindow();

      let message = getProgressMessage(event);
      if (message != null) {
        if (isTTY) {
          statusThrottle(message);
        } else {
          updateSpinner('buildProgress', message);
        }
      }
      break;
    }
    case 'buildSuccess':
      if (logLevelFilter < logLevels.info) {
        break;
      }

      persistSpinner(
        'buildProgress',
        'success',
        `Built in ${prettifyTime(event.buildTime)}`,
      );

      if (options.mode === 'production') {
        bundleReport(event.bundleGraph);
      }
      break;
    case 'buildFailure':
      if (logLevelFilter < logLevels.error) {
        break;
      }

      persistSpinner('buildProgress', 'error', 'Build failed.');

      writeDiagnostic(event.diagnostics, true);
      break;
    case 'log': {
      switch (event.level) {
        case 'success':
        case 'progress':
          writeOut(event.message);
          break;
        case 'verbose':
        case 'info':
          writeDiagnostic(event.diagnostics);
          break;
        case 'warn':
        case 'error':
          writeDiagnostic(event.diagnostics, true);
          break;
        default:
          throw new Error('Unknown log level ' + event.level);
      }
    }
  }
}

function writeDiagnostic(diagnostics: Array<Diagnostic>, isError?: boolean) {
  for (let diagnostic of diagnostics) {
    let {message, stack, codeframe, hints} = prettyDiagnostic(diagnostic);

    if (message) {
      writeOut(message, isError);
    }

    if (stack) {
      writeOut(stack, isError);
    }

    if (codeframe) {
      writeOut(codeframe, isError);
    }

    for (let hint of hints) {
      writeOut(hint, isError);
    }
  }
}
