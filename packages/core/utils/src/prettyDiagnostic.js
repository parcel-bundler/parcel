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
  let {origin, message, stack, codeframe, hints, filename} = diagnostic;

  let result = {
    message: '',
    stack: '',
    codeframe: '',
    hints: []
  };

  result.message = mdAnsi(`**${origin}**: ${message}`);
  result.stack = stack || '';

  if (codeframe !== undefined) {
    let highlights = Array.isArray(codeframe.codeHighlights)
      ? codeframe.codeHighlights
      : [codeframe.codeHighlights];

    let formattedCodeFrame = formatCodeFrame(codeframe.code, highlights, {
      useColor: true
    });

    result.codeframe +=
      typeof filename !== 'string' ? '' : mdAnsi(`__${filename}__`);
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
