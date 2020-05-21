// @flow
import type {ReporterEvent, PluginOptions} from '@parcel/types';
import type {Diagnostic} from '@parcel/diagnostic';

import {Reporter} from '@parcel/plugin';
import {prettifyTime, prettyDiagnostic, throttle} from '@parcel/utils';
import chalk from 'chalk';

import {getProgressMessage, getTerminalWidth} from './utils';
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
export async function _report(
  event: ReporterEvent,
  options: PluginOptions,
): Promise<void> {
  let logLevelFilter = logLevels[options.logLevel || 'info'];

  switch (event.type) {
    case 'buildStart': {
      if (logLevelFilter < logLevels.info) {
        break;
      }

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
        await bundleReport(
          event.bundleGraph,
          options.outputFS,
          options.projectRoot,
          options.detailedReport,
        );
      }
      break;
    case 'buildFailure':
      if (logLevelFilter < logLevels.error) {
        break;
      }

      resetWindow();

      persistSpinner('buildProgress', 'error', chalk.red.bold('Build failed.'));

      await writeDiagnostic(options, event.diagnostics, 'red', true);
      break;
    case 'log': {
      if (logLevelFilter < logLevels[event.level]) {
        break;
      }

      switch (event.level) {
        case 'success':
          writeOut(chalk.green(event.message));
          break;
        case 'progress':
          writeOut(event.message);
          break;
        case 'verbose':
        case 'info':
          await writeDiagnostic(options, event.diagnostics, 'blue');
          break;
        case 'warn':
          await writeDiagnostic(options, event.diagnostics, 'yellow', true);
          break;
        case 'error':
          await writeDiagnostic(options, event.diagnostics, 'red', true);
          break;
        default:
          throw new Error('Unknown log level ' + event.level);
      }
    }
  }
}

async function writeDiagnostic(
  options: PluginOptions,
  diagnostics: Array<Diagnostic>,
  color: string,
  isError: boolean = false,
) {
  for (let diagnostic of diagnostics) {
    let {message, stack, codeframe, hints} = await prettyDiagnostic(
      diagnostic,
      options,
      getTerminalWidth().columns,
    );
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

    // Write hints
    for (let hint of hints) {
      writeOut(chalk.blue.bold(hint));
    }
  }
}

export default new Reporter({
  report({event, options}) {
    return _report(event, options);
  },
});
