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

let statusThrottle = throttle((message: string) => {
  updateSpinner(message);
}, THROTTLE_DELAY);

// Exported only for test
export function _report(event: ReporterEvent, options: PluginOptions): void {
  let logLevelFilter = logLevels[options.logLevel || 'info'];

  switch (event.type) {
    case 'buildStart': {
      // Clear any previous output
      resetWindow();

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

      let message = getProgressMessage(event);
      if (message != null) {
        if (isTTY) {
          statusThrottle(chalk.gray.bold(message));
        } else {
          updateSpinner(message);
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
        chalk.green.bold(`Built in ${prettifyTime(event.buildTime)}`),
      );

      if (options.mode === 'production') {
        bundleReport(event.bundleGraph);
      }
      break;
    case 'buildFailure':
      if (logLevelFilter < logLevels.error) {
        break;
      }

      resetWindow();

      persistSpinner('buildProgress', 'error', chalk.red.bold('Build failed.'));

      writeDiagnostic(event.diagnostics, 'red', true);
      break;
    case 'log': {
      switch (event.level) {
        case 'success':
          writeOut(chalk.green(event.message));
          break;
        case 'progress':
          writeOut(event.message);
          break;
        case 'verbose':
        case 'info':
          writeDiagnostic(event.diagnostics, 'blue');
          break;
        case 'warn':
          writeDiagnostic(event.diagnostics, 'yellow', true);
          break;
        case 'error':
          writeDiagnostic(event.diagnostics, 'red', true);
          break;
        default:
          throw new Error('Unknown log level ' + event.level);
      }
    }
  }
}

function writeDiagnostic(
  diagnostics: Array<Diagnostic>,
  color: string,
  isError: boolean = false,
) {
  for (let diagnostic of diagnostics) {
    let {message, stack, codeframe, hints} = prettyDiagnostic(diagnostic);
    message = chalk[color](message);

    if (message) {
      writeOut(message, isError);
    }

    if (stack) {
      writeOut(chalk.gray(stack), isError);
    }

    if (codeframe) {
      writeOut(codeframe, isError);
    }

    if (hints.length) {
      writeOut(chalk.blue.bold(`${emoji.info} Hints:`));
    }

    for (let hint of hints) {
      writeOut(chalk.blue.bold(`- ${hint}`));
    }
  }
}

export default new Reporter({
  report({event, options}) {
    _report(event, options);
  },
});
