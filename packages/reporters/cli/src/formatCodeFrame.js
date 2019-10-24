// @flow
import codeframeFormatter from '@parcel/codeframe';

import type {DiagnosticCodeFrame} from '@parcel/diagnostic';

export default function formatCodeFrame(
  codeframe: DiagnosticCodeFrame
): string {
  if (codeframe.codeHighlights.length === 0) {
    return 'Could not create codeframe, no highlights defined.';
  }

  let highlights = Array.isArray(codeframe.codeHighlights)
    ? codeframe.codeHighlights
    : [codeframe.codeHighlights];

  let result = codeframeFormatter(codeframe.code, highlights, {
    useColor: true
  });

  return result;
}
