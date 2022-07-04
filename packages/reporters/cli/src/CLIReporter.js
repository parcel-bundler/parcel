// @flow
import type {ReporterEvent, PluginOptions} from '@parcel/types';
import type {Diagnostic} from '@parcel/diagnostic';
import type {Color} from 'chalk';

import {Reporter} from '@parcel/plugin';
import {prettifyTime, prettyDiagnostic, throttle} from '@parcel/utils';
import chalk from 'chalk';
import {applyDiagnosticFix} from '@parcel/diagnostic';

import {getProgressMessage, wrapWithIndent, indentString} from './utils';
import logLevels from './logLevels';
import bundleReport from './bundleReport';
import {
  init,
  exit,
  writeOut,
  updateSpinner,
  persistSpinner,
  isTTY,
  resetWindow,
  persistMessage,
  getLocation,
  moveBy,
  scrollTo,
  getPageHeight,
  scrollIfNeeded,
  addFooterLine,
  updateFooterLine,
  terminalSize,
} from './render';
import {initFixes, resetFixes, renderFix, renderFooter} from './fix';
import * as emoji from './emoji';
import wrapAnsi from 'wrap-ansi';

const THROTTLE_DELAY = 100;
const seenWarnings = new Set();
const seenPhases = new Set();

let isWatching = false;

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
    case 'watchStart':
      isWatching = true;

      init();
      initFixes();

      if (options.serveOptions) {
        persistMessage(
          chalk.blue.bold(
            `Server running at ${
              options.serveOptions.https ? 'https' : 'http'
            }://${options.serveOptions.host ?? 'localhost'}:${
              options.serveOptions.port
            }`,
          ),
        );
      }

      break;

    case 'watchEnd':
      exit();
      break;

    case 'buildStart': {
      seenWarnings.clear();
      seenPhases.clear();
      if (logLevelFilter < logLevels.info) {
        break;
      }

      // Clear any previous output
      resetWindow();
      resetFixes();

      break;
    }
    case 'buildProgress': {
      if (logLevelFilter < logLevels.info) {
        break;
      }

      if (!isTTY && logLevelFilter != logLevels.verbose) {
        if (event.phase == 'transforming' && !seenPhases.has('transforming')) {
          updateSpinner('Building...');
        } else if (event.phase == 'bundling' && !seenPhases.has('bundling')) {
          updateSpinner('Bundling...');
        } else if (
          (event.phase == 'packaging' || event.phase == 'optimizing') &&
          !seenPhases.has('packaging') &&
          !seenPhases.has('optimizing')
        ) {
          updateSpinner('Packaging & Optimizing...');
        }
        seenPhases.add(event.phase);

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
          options.detailedReport?.assetsPerBundle,
        );
      }
      break;
    case 'buildFailure':
      if (logLevelFilter < logLevels.error) {
        break;
      }

      resetWindow();
      resetFixes();

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
          if (
            event.diagnostics.some(
              diagnostic => !seenWarnings.has(diagnostic.message),
            )
          ) {
            await writeDiagnostic(options, event.diagnostics, 'yellow', true);
            for (let diagnostic of event.diagnostics) {
              seenWarnings.add(diagnostic.message);
            }
          }
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
  color: Color,
  isError: boolean = false,
) {
  let columns = terminalSize.columns;
  let indent = 2;
  for (let diagnostic of diagnostics) {
    let {message, stack, codeframe, hints, fixes, documentation} =
      await prettyDiagnostic(diagnostic, options, columns - indent);
    // $FlowFixMe[incompatible-use]
    message = chalk[color](message);

    if (isError) {
      writeOut('', isError);
    }

    if (message) {
      writeOut(wrapWithIndent(message), isError);
    }

    if (stack || codeframe) {
      writeOut('', isError);
    }

    if (stack) {
      writeOut(chalk.gray(wrapWithIndent(stack, indent)), isError);
    }

    if (codeframe) {
      writeOut(indentString(codeframe, indent), isError);
    }

    if (
      (stack || codeframe) &&
      (hints.length > 0 || fixes.length > 0 || documentation)
    ) {
      writeOut('', isError);
    }

    // Write hints
    let hintIndent = stack || codeframe ? indent : 0;
    for (let hint of hints) {
      writeOut(
        wrapWithIndent(
          `${emoji.hint} ${chalk.blue.bold(hint)}`,
          hintIndent + 3,
          hintIndent,
        ),
        isError,
      );
    }

    if (Array.isArray(diagnostic.fixes) && diagnostic.fixes.length) {
      for (let fix of diagnostic.fixes) {
        await renderFix(fix, options);
      }
    }

    if (fixes.length > 0 && documentation) {
      writeOut('', isError);
    }

    if (documentation) {
      writeOut(
        wrapWithIndent(
          `${emoji.docs} ${chalk.magenta.bold(documentation)}`,
          hintIndent + 3,
          hintIndent,
        ),
        isError,
      );
    }
  }

  let hasFooter = renderFooter(options);
  if (!hasFooter && isError) {
    writeOut('', isError);
  }
}

export default (new Reporter({
  report({event, options}) {
    return _report(event, options);
  },
}): Reporter);
