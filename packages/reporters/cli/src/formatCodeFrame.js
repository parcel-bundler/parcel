// @flow
import {codeFrameColumns} from '@babel/code-frame';

import type {DiagnosticCodeFrame} from '@parcel/diagnostic';

export default function formatCodeFrame(
  codeframe: DiagnosticCodeFrame
): string {
  if (codeframe.codeHighlights.length === 0) {
    return 'Could not create codeframe, no highlights defined.';
  }

  // TODO: Support multiple code highlights
  let highlight = Array.isArray(codeframe.codeHighlights)
    ? codeframe.codeHighlights[0]
    : codeframe.codeHighlights;

  let result = codeFrameColumns(
    codeframe.code,
    {start: highlight.start, end: highlight.end},
    {
      highlightCode: true,
      linesAbove: 2,
      linesBelow: 2,
      forceColor: true,
      message: highlight.hint
    }
  );

  return result;
}
