// @flow strict-local
import type {Diagnostic} from '@parcel/diagnostic';
import type {PluginOptions} from '@parcel/types';

import formatCodeFrame from '@parcel/codeframe';
import mdAnsi from '@parcel/markdown-ansi';
import chalk from 'chalk';
import path from 'path';
import nullthrows from 'nullthrows';

export type AnsiDiagnosticResult = {|
  message: string,
  stack: string,
  codeframe: string,
  hints: Array<string>,
|};

export default async function prettyDiagnostic(
  diagnostic: Diagnostic,
  options?: PluginOptions,
  terminalWidth?: number,
): Promise<AnsiDiagnosticResult> {
  let {
    origin,
    message,
    stack,
    codeFrame,
    hints,
    filePath,
    language,
    skipFormatting,
  } = diagnostic;

  if (filePath != null && options && !path.isAbsolute(filePath)) {
    filePath = path.join(options.projectRoot, filePath);
  }

  let result = {
    message:
      mdAnsi(`**${origin ?? 'unknown'}**: `) +
      (skipFormatting ? message : mdAnsi(message)),
    stack: '',
    codeframe: '',
    hints: [],
  };

  if (codeFrame !== undefined) {
    let highlights = codeFrame.codeHighlights;
    let code =
      codeFrame.code ??
      (options &&
        (await options.inputFS.readFile(nullthrows(filePath), 'utf8')));

    let formattedCodeFrame = '';
    if (code != null) {
      formattedCodeFrame = formatCodeFrame(code, highlights, {
        useColor: true,
        syntaxHighlighting: true,
        language:
          // $FlowFixMe sketchy null checks do not matter here...
          language || (filePath ? path.extname(filePath).substr(1) : undefined),
        terminalWidth,
      });
    }

    result.codeframe +=
      typeof filePath !== 'string'
        ? ''
        : chalk.underline(
            `${filePath}:${highlights[0].start.line}:${highlights[0].start.column}\n`,
          );
    result.codeframe += formattedCodeFrame;
  } else if (typeof filePath === 'string') {
    result.codeframe += chalk.underline(filePath);
  }

  if (stack != null) {
    result.stack = stack;
  } else if (filePath != null && result.codeframe == null) {
    result.stack = filePath;
  }

  if (Array.isArray(hints) && hints.length) {
    result.hints = hints.map(h => {
      return mdAnsi(h);
    });
  }

  return result;
}
