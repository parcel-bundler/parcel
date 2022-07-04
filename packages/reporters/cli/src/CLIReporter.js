// @flow
import type {ReporterEvent, PluginOptions} from '@parcel/types';
import type {Diagnostic} from '@parcel/diagnostic';
import type {Color} from 'chalk';

import {Reporter} from '@parcel/plugin';
import {prettifyTime, prettyDiagnostic, throttle} from '@parcel/utils';
import chalk from 'chalk';
import {applyDiagnosticFix} from '@parcel/diagnostic';

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
  getLocation,
  moveBy,
  updateLine,
  scrollTo,
  getPageHeight,
  scrollIfNeeded,
  addFooterLine,
  updateFooterLine,
} from './render';
import * as emoji from './emoji';
import wrapAnsi from 'wrap-ansi';

const THROTTLE_DELAY = 100;
const seenWarnings = new Set();
const seenPhases = new Set();

let isWatching = false;
let buttons = [];
let activeButton = -1;

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

      if (isTTY) {
        process.stderr.write('\x1b[?1049h'); // use alternate buffer
        process.stderr.write('\x1b[?1h'); // enable application cursor keys
        process.stderr.write('\x1b='); // enable application keypad
      }

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
      if (isTTY) {
        process.stderr.write('\x1b>'); // disable application keypad
        process.stderr.write('\x1b[?1l'); // disable application cursor keys
        process.stderr.write('\x1b[?1049l'); // disable alternate buffer
      }
      break;

    case 'buildStart': {
      seenWarnings.clear();
      seenPhases.clear();
      if (logLevelFilter < logLevels.info) {
        break;
      }

      // Clear any previous output
      resetWindow();

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
  buttons.length = 0;

  if (isTTY) {
    // TODO: why doesn't this work during initialization?
    process.stderr.write('\x1b[?25l'); // hide cursor
  }

  let columns = getTerminalWidth().columns;
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

  if (buttons.length) {
    addFooterLine('');
    addFooterLine(' ' + chalk.gray('─'.repeat(columns - 2)) + ' ');
    addFooterLine('');
    let allAccepted = buttons.slice(0, -1).filter(b => b.accept);
    addButton({
      line: 3,
      scrollLine: 3,
      column: 2,
      text: chalk.underline(
        `Apply ${allAccepted.length} selected ${
          allAccepted.length === 1 ? 'fix' : 'fixes'
        }`,
      ),
      disabled: false,
      footer: true,
      action: async () => {
        for (let button of buttons.slice(0, -1)) {
          await applyDiagnosticFix(button.fix, options.inputFS);
        }
      },
    });

    addFooterLine('');
  } else if (isError) {
    writeOut('', isError);
  }

  if (buttons.length) {
    updateButtons(buttons.length - 1);
  }
}

import nullthrows from 'nullthrows';
import {formatDiff} from '@parcel/codeframe';
import path from 'path';

async function renderFix(fix, options, {index, length} = {}) {
  if (fix.type === 'patch') {
    let code = await options.inputFS.readFile(nullthrows(fix.filePath), 'utf8');
    let formatted = formatDiff(code, fix.edits, {
      useColor: true,
      syntaxHighlighting: true,
      language:
        fix.filePath != null ? path.extname(fix.filePath).substr(1) : undefined,
      terminalWidth: getTerminalWidth().columns,
    });

    let message =
      chalk.bold.blue((index == null ? 'Fix: ' : `${index}) `) + fix.message) +
      '\n\n';

    let location = `${fix.filePath}:${fix.edits[0].range.start.line}:${fix.edits[0].range.start.column}`;
    message += chalk.gray.underline(location) + '\n';

    if (index == null) {
      message = emoji.hint + ' ' + message;
    }

    // result.fixes.push(message + formatted);
    let fixLine = getLocation();
    writeOut(
      wrapWithIndent(
        message + formatted,
        index == null ? 5 : 8,
        index == null ? 2 : 5,
      ),
    );

    if (isWatching && isTTY) {
      writeOut('', true);
      let buttonIndex = buttons.length;
      let accept = index == null ? true : index === 1;
      let button = {
        line: getLocation(),
        scrollLine: fixLine,
        column: index == null ? 5 : 8,
        text: (accept ? '◉ ' : '◯ ') + chalk.underline('Accept fix'),
        accept,
        fix,
        async action() {
          if (index == null) {
            button.accept = !button.accept;
            button.text =
              (button.accept ? '◉ ' : '◯ ') + chalk.underline('Accept fix');
            writeButton(button, true);
          } else {
            let baseIndex = buttonIndex - index + 1;
            for (let i = 0; i < length; i++) {
              let b = buttons[baseIndex + i];
              if (i === index - 1) {
                b.accept = !b.accept;
              } else {
                b.accept = false;
              }
              b.text = (b.accept ? '◉ ' : '◯ ') + chalk.underline('Accept fix');
              writeButton(b, i === index - 1);
            }
          }

          let allButton = buttons[buttons.length - 1];
          let allAccepted = buttons.slice(0, -1).filter(b => b.accept);
          allButton.text = chalk.underline(
            allAccepted.length === 0
              ? 'No fixes selected'
              : `Apply ${allAccepted.length} selected ${
                  allAccepted.length === 1 ? 'fix' : 'fixes'
                }`,
          );

          allButton.disabled = allAccepted.length === 0;
          writeButton(allButton, false);
        },
      };
      addButton(button);
    }
  } else if (fix.type === 'group') {
    writeOut(
      wrapWithIndent(
        chalk.bold.blue(`${emoji.hint} ${fix.options.length} possible fixes:`),
        5,
        2,
      ) + '\n',
    );
    for (let [index, option] of fix.options.entries()) {
      await renderFix(option, options, {
        index: index + 1,
        length: fix.options.length,
      });
      writeOut('\n');
    }
  }
}

import readline from 'readline';

function addButton(button) {
  buttons.push(button);
  writeButton(button, false);
}

function writeButton(button, focused) {
  let update = button.footer ? updateFooterLine : updateLine;

  if (button.disabled) {
    if (focused) {
      update(
        button.column,
        button.line,
        chalk.bgBlackBright.hex('#fff')(chalk(button.text)),
      );
    } else {
      update(button.column, button.line, chalk.gray(button.text));
    }
  } else {
    if (focused) {
      update(
        button.column,
        button.line,
        chalk.bgBlue
          .hex('#fff')
          .bold(chalk(button.text) + (button.accept != null ? '' : ' ↵')),
      );
    } else {
      update(button.column, button.line, chalk.bold.blue(button.text));
    }
  }
}

function updateButtons(newButton) {
  if (activeButton >= 0) {
    writeButton(buttons[activeButton], false);
  }

  writeButton(buttons[newButton], true);
  activeButton = newButton;
}

function wrapWithIndent(string, indent = 0, initialIndent = indent) {
  let width = getTerminalWidth().columns;
  return indentString(
    wrapAnsi(string.trimEnd(), width - indent, {trim: false}),
    indent,
    initialIndent,
  );
}

function indentString(string, indent = 0, initialIndent = indent) {
  return (
    ' '.repeat(initialIndent) + string.replace(/\n/g, '\n' + ' '.repeat(indent))
  );
}

export default (new Reporter({
  report({event, options}) {
    return _report(event, options);
  },
}): Reporter);

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', key => {
  if (buttons.length === 0) return;

  for (let i = 0; i < key.length; ) {
    if (isKey(key, i, '\x1b[Z')) {
      // tab backward
      let b = activeButton - 1;
      if (b < 0) {
        b = buttons.length - 1;
      }
      if (!buttons[b].footer) {
        scrollIfNeeded(buttons[b].scrollLine);
        scrollIfNeeded(buttons[b].line);
      }
      updateButtons(b);
      i += 3;
    } else if (isKey(key, i, '\t') || isKey(key, i, '\x1b[I')) {
      // tab forward
      let b = (activeButton + 1) % buttons.length;
      if (!buttons[b].footer) {
        scrollIfNeeded(buttons[b].scrollLine);
        scrollIfNeeded(buttons[b].line);
      }
      updateButtons(b);
      i += key[i] === '\t' ? 1 : 3;
    } else if (isKey(key, i, '\r')) {
      // enter
      let button = buttons[activeButton];
      if (!button.disabled) {
        button.action();
      }
      i++;
    } else if (isKey(key, i, '\x1bOB')) {
      // down arrow
      moveBy(1);
      i += 3;
    } else if (isKey(key, i, '\x1bOA')) {
      // up arrow
      moveBy(-1);
      i += 3;
    } else if (isKey(key, i, '\x1b[6~')) {
      // page down
      moveBy(getPageHeight());
      i += 4;
    } else if (isKey(key, i, '\x1b[5~')) {
      // page up
      moveBy(-getPageHeight());
      i += 4;
    } else if (isKey(key, i, '\x1bOH')) {
      // home
      scrollTo(0);
      i += 3;
    } else if (isKey(key, i, '\x1bOF')) {
      // end
      scrollTo(Infinity);
      i += 3;
    } else {
      i++;
    }
  }
});

function isKey(s: string, i: number, k: string): boolean {
  return s.slice(i, i + k.length) === k;
}
