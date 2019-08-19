// @flow
import type {FilePath} from '@parcel/types';
import {EOL} from 'os';
import {codeFrameColumns} from '@babel/code-frame';
import chalk from 'chalk';
import path from 'path';

import type {Diagnostic} from 'typescript';

type CodeFrameError = Error & {codeFrame?: string, ...};
type Location = {
  line: number,
  column: number,
  ...
};
type CodeFrameLocation = {
  start: Location,
  end?: Location,
  ...
};

export default function formatDiagnostics(
  diagnostics: Array<Diagnostic>,
  fileName: FilePath,
  rootDir: FilePath
): null | CodeFrameError {
  if (!diagnostics || diagnostics.length === 0) return null;

  let err: CodeFrameError = new Error(
    `TypeScript errors in ${path.relative(rootDir, fileName)}`
  );
  err.codeFrame =
    EOL +
    diagnostics
      .map(diagnostic => {
        const {file} = diagnostic;
        let messageText = chalk.redBright(
          typeof diagnostic.messageText === 'string'
            ? diagnostic.messageText
            : diagnostic.messageText.messageText
        );
        let messages = [];

        if (file != null && diagnostic.start != null) {
          const lineChar = file.getLineAndCharacterOfPosition(diagnostic.start);
          const source = file.text || diagnostic.source;
          const start = {
            line: lineChar.line + 1,
            column: lineChar.character + 1
          };
          const location: CodeFrameLocation = {start};
          const red = chalk.red(
            `${file.fileName}:${start.line}:${start.column}:`
          );
          messages.push(red);
          messages.push(messageText);

          if (source != null) {
            if (typeof diagnostic.length === 'number') {
              const end = file.getLineAndCharacterOfPosition(
                diagnostic.start + diagnostic.length
              );

              location.end = {
                line: end.line + 1,
                column: end.character + 1
              };
            }

            const frame = codeFrameColumns(source, location, {
              linesAbove: 1,
              linesBelow: 1,
              highlightCode: true
            });

            messages.push(
              frame
                .split(EOL)
                .map(str => `  ${str}`)
                .join(EOL)
            );
          }
        }

        return messages.length > 0 ? messages.join(EOL) : messageText;
      })
      .join(EOL);

  return err;
}
