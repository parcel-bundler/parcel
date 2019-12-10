// @flow strict-local
import type {Diagnostic} from '@parcel/diagnostic';

import formatCodeFrame from '@parcel/codeframe';
import mdAnsi from '@parcel/markdown-ansi';
import chalk from 'chalk';
import path from 'path';

export type AnsiDiagnosticResult = {|
  message: string,
  stack: string,
  codeframe: string,
  hints: Array<string>,
|};

export default function prettyDiagnostic(
  diagnostic: Diagnostic,
): AnsiDiagnosticResult {
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

  let result = {
    message: '',
    stack: '',
    codeframe: '',
    hints: [],
  };

  result.message =
    mdAnsi(`**${origin ?? 'unknown'}**: `) +
    (skipFormatting ? message : mdAnsi(message));
  result.stack = stack || '';

  if (codeFrame !== undefined) {
    let highlights = Array.isArray(codeFrame.codeHighlights)
      ? codeFrame.codeHighlights
      : [codeFrame.codeHighlights];

    let formattedCodeFrame = formatCodeFrame(codeFrame.code, highlights, {
      useColor: true,
      syntaxHighlighting: true,
      language:
        // $FlowFixMe sketchy null checks do not matter here...
        language || (filePath ? path.extname(filePath).substr(1) : undefined),
    });

    result.codeframe +=
      typeof filePath !== 'string'
        ? ''
        : chalk.underline(
            `${filePath}:${highlights[0].start.line}:${highlights[0].start.column}\n`,
          );
    result.codeframe += formattedCodeFrame;
  }

  if (Array.isArray(hints) && hints.length) {
    result.hints = hints.map(h => {
      return mdAnsi(h);
    });
  }

  return result;
}
