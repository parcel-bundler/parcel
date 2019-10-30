// @flow strict-local
import type {Diagnostic} from '@parcel/diagnostic';

import formatCodeFrame from '@parcel/codeframe';
import mdAnsi from '@parcel/markdown-ansi';

type AnsiDiagnosticResult = {|
  message: string,
  stack: string,
  codeframe: string,
  hints: Array<string>
|};

export default function prettyDiagnostic(
  diagnostic: Diagnostic
): AnsiDiagnosticResult {
  let {origin, message, stack, codeFrame, hints, filePath} = diagnostic;

  let result = {
    message: '',
    stack: '',
    codeframe: '',
    hints: []
  };

  result.message = mdAnsi(`**${origin}**: ${message}`);
  result.stack = stack || '';

  if (codeFrame !== undefined) {
    let highlights = Array.isArray(codeFrame.codeHighlights)
      ? codeFrame.codeHighlights
      : [codeFrame.codeHighlights];

    let formattedCodeFrame = formatCodeFrame(codeFrame.code, highlights, {
      useColor: true
    });

    result.codeframe +=
      typeof filePath !== 'string' ? '' : mdAnsi(`__${filePath}__`);
    result.codeframe += `@${highlights
      .map(h => {
        return `${h.start.line}:${h.start.column}`;
      })
      .join(',')}\n`;
    result.codeframe += formattedCodeFrame;
  }

  if (Array.isArray(hints) && hints.length) {
    result.hints = hints.map(h => {
      return mdAnsi(h);
    });
  }

  return result;
}
