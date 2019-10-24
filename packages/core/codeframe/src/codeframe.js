// @flow
import chalk from 'chalk';
import type {DiagnosticCodeHighlight} from '@parcel/diagnostic';

type CodeFrameOptions = {|
  useColor?: boolean,
  padding?: {|
    before: number,
    after: number
  |}
|};

const NEWLINE = /\r\n|[\n\r\u2028\u2029]/;

// TODO: Implement padding, so we don't return an entire source file
// Padding = rendering lines before first highlight and after last highlight
export default function codeFrame(
  code: string,
  highlights: Array<DiagnosticCodeHighlight>,
  opts: CodeFrameOptions = {
    useColor: true,
    padding: {
      before: 2,
      after: 2
    }
  }
): string {
  const highlighter = (s: string) => {
    if (opts.useColor) {
      return chalk.red(s);
    }

    return s;
  };

  // Make columns/lines start at 1
  highlights = highlights.map(h => {
    return {
      start: {
        column: h.start.column - 1,
        line: h.start.line - 1
      },
      end: {
        column: h.end.column - 1,
        line: h.end.line - 1
      },
      message: h.message
    };
  });

  let resultLines = [];
  const lines = code.split(NEWLINE);
  for (let i = 0; i < lines.length; i++) {
    let originalLine = lines[i];
    let foundHighlights = highlights.filter(
      highlight => highlight.start.line <= i && highlight.end.line >= i
    );

    resultLines.push(
      `${foundHighlights.length > 0 ? highlighter('>') : ' '} ${i + 1} | ` +
        originalLine
    );

    if (foundHighlights.length > 0) {
      let highlightLine = `${highlighter('>')}   | `;
      let isWholeLine = !!foundHighlights.find(
        h => h.start.line < i && h.end.line > i
      );

      if (isWholeLine) {
        // If there's a whole line highlight
        // don't even bother creating seperate highlight
        highlightLine += highlighter('^'.repeat(originalLine.length));
      } else {
        let sortedColumns =
          foundHighlights.length > 1
            ? foundHighlights.sort(
                (a, b) =>
                  (a.start.line < i ? 0 : a.start.column) -
                  (b.start.line < i ? 0 : b.start.column)
              )
            : foundHighlights;

        let lastCol = 0;
        for (let col of sortedColumns) {
          let startCol = col.start.line === i ? col.start.column : 0;
          let endCol =
            (col.end.line === i
              ? col.end.column
              : originalLine.length - (lastCol || 1)) + 1;

          let whitespaceLength = startCol - lastCol;
          if (whitespaceLength > 0) {
            highlightLine += ' '.repeat(whitespaceLength);
          }

          let highlightLength =
            endCol - (lastCol > startCol ? lastCol : startCol);
          if (highlightLength > 0) {
            highlightLine += highlighter('^'.repeat(highlightLength));
            lastCol = endCol;
          }
        }

        let endsWithFullLine = !!sortedColumns.find(h => h.end.line > i);
        if (!endsWithFullLine) {
          let sortedByEnd = sortedColumns.sort(
            (a, b) => a.end.column - b.end.column
          );

          let lastHighlightForColumn = sortedByEnd[sortedByEnd.length - 1];
          if (lastHighlightForColumn.message) {
            highlightLine += ' ' + lastHighlightForColumn.message;
          }
        }
      }

      resultLines.push(highlightLine);
    }
  }

  return resultLines.join('\n');
}
