// @flow
import type {FilePath} from '@parcel/types';
import {parse} from 'json5';
import ThrowableDiagnostic from '@parcel/diagnostic';

export default function(path: FilePath, contents: string): any {
  try {
    return parse(contents);
  } catch (e) {
    let pos = {
      line: e.lineNumber,
      column: e.columnNumber,
    };
    throw new ThrowableDiagnostic({
      diagnostic: {
        message: 'Failed to parse JSON5',
        origin: '@parcel/core',
        filePath: path,
        language: 'json5',
        codeFrame: {
          code: contents,
          codeHighlights: [
            {
              start: pos,
              end: pos,
              message: e.message,
            },
          ],
        },
      },
    });
  }
}
