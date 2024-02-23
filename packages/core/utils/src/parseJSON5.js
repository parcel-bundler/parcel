// @flow
import type {FilePath} from '@parcel/types';

import ThrowableDiagnostic, {escapeMarkdown} from '@parcel/diagnostic';
import json5 from 'json5';

export default function (path: FilePath, contents: string): any {
  try {
    return json5.parse(contents);
  } catch (e) {
    let pos = {
      line: e.lineNumber,
      column: e.columnNumber,
    };
    throw new ThrowableDiagnostic({
      diagnostic: {
        message: `Failed to parse JSON5`,
        origin: '@parcel/core',

        codeFrames: [
          {
            filePath: path,
            language: 'json5',
            code: contents,
            codeHighlights: [
              {
                start: pos,
                end: pos,
                message: escapeMarkdown(e.message),
              },
            ],
          },
        ],
      },
    });
  }
}
