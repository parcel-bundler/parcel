// @flow
import type {PluginOptions} from '@parcel/types';
import type {DiagnosticFix} from '@parcel/diagnostic';
import path from 'path';
import nullthrows from 'nullthrows';
import chalk from 'chalk';
import {formatDiff} from '@parcel/codeframe';
import {applyDiagnosticFix} from '@parcel/diagnostic';
import * as emoji from './emoji';
import {wrapWithIndent, indentString} from './utils';
import {
  writeOut,
  isTTY,
  getLocation,
  moveBy,
  updateLine,
  scrollTo,
  getPageHeight,
  scrollIfNeeded,
  addFooterLine,
  updateFooterLine,
  terminalSize,
} from './render';

type Button = {|
  text: string,
  line: number,
  action(): Promise<void>,
  column: number,
  scrollLine: number,
  fix?: DiagnosticFix,
  accept?: boolean,
  disabled?: boolean,
  footer?: boolean,
|};

let buttons: Array<Button> = [];
let activeButton = -1;
let acceptButton = null;
let isInteractive = false;

export function resetFixes() {
  buttons.length = 0;
  activeButton = -1;
}

export function initFixes() {
  isInteractive = isTTY;

  // $FlowFixMe
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
        scrollToButton(buttons[b]);
        updateButtons(b);
        i += 3;
      } else if (isKey(key, i, '\t') || isKey(key, i, '\x1b[I')) {
        // tab forward
        let b = (activeButton + 1) % buttons.length;
        scrollToButton(buttons[b]);
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
}

function isKey(s: string, i: number, k: string): boolean {
  return s.slice(i, i + k.length) === k;
}

export async function renderFix(
  fix: DiagnosticFix,
  options: PluginOptions,
  group?: {|index: number, length: number|},
) {
  if (fix.type === 'patch') {
    let code = await options.inputFS.readFile(nullthrows(fix.filePath), 'utf8');
    let formatted = formatDiff(code, fix.edits, {
      useColor: true,
      syntaxHighlighting: true,
      language:
        fix.filePath != null ? path.extname(fix.filePath).substr(1) : undefined,
      terminalWidth: terminalSize.columns,
    });

    let message =
      chalk.bold.blue(
        (group == null ? 'Fix: ' : `${group.index}) `) + fix.message,
      ) + '\n\n';

    let location = `${fix.filePath}:${fix.edits[0].range.start.line}:${fix.edits[0].range.start.column}`;
    message += chalk.gray.underline(location) + '\n';

    if (group == null) {
      message = emoji.hint + ' ' + message;
    }

    // result.fixes.push(message + formatted);
    let fixLine = getLocation();
    writeOut(
      wrapWithIndent(
        message + formatted,
        group == null ? 5 : 8,
        group == null ? 2 : 5,
      ),
    );

    if (isInteractive) {
      writeOut('', true);
      let buttonIndex = buttons.length;
      let accept = group == null ? true : group.index === 1;
      let button = {
        line: getLocation(),
        scrollLine: fixLine,
        column: group == null ? 5 : 8,
        text: radioButton(accept),
        accept,
        fix,
        async action() {
          if (group == null) {
            button.accept = !button.accept;
            button.text = radioButton(button.accept);
            writeButton(button, true);
          } else {
            let baseIndex = buttonIndex - group.index + 1;
            for (let i = 0; i < group.length; i++) {
              let b = buttons[baseIndex + i];
              if (i === group.index - 1) {
                b.accept = !b.accept;
              } else {
                b.accept = false;
              }
              b.text = radioButton(b.accept);
              writeButton(b, i === group.index - 1);
            }
          }

          updateAcceptButton();
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

function addButton(button: Button) {
  buttons.push(button);
  writeButton(button, false);
  return button;
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

export function renderFooter(options: PluginOptions): boolean {
  if (isInteractive && buttons.length) {
    addFooterLine('');
    addFooterLine(' ' + chalk.gray('─'.repeat(terminalSize.columns - 2)) + ' ');
    addFooterLine('');
    let allAccepted = buttons.filter(b => b.fix && b.accept);
    acceptButton = addButton({
      line: 3,
      scrollLine: 3,
      column: 2,
      footer: true,
      text: chalk.underline(
        `Apply ${allAccepted.length} selected ${
          allAccepted.length === 1 ? 'fix' : 'fixes'
        }`,
      ),
      disabled: false,
      action: async () => {
        for (let button of buttons) {
          if (button.fix) {
            await applyDiagnosticFix(button.fix, options.inputFS);
          }
        }
      },
    });

    addFooterLine('');
    updateButtons(buttons.length - 1);
    return true;
  }

  return false;
}

function updateAcceptButton() {
  if (!acceptButton) {
    return;
  }

  let allAccepted = buttons.slice(0, -1).filter(b => b.accept);
  acceptButton.text = chalk.underline(
    allAccepted.length === 0
      ? 'No fixes selected'
      : `Apply ${allAccepted.length} selected ${
          allAccepted.length === 1 ? 'fix' : 'fixes'
        }`,
  );

  acceptButton.disabled = allAccepted.length === 0;
  writeButton(acceptButton, false);
}

function scrollToButton(button) {
  if (!button.footer) {
    scrollIfNeeded(button.scrollLine);
    scrollIfNeeded(button.line);
  }
}

function radioButton(accept) {
  return (accept ? '◉ ' : '◯ ') + chalk.underline('Select fix');
}
