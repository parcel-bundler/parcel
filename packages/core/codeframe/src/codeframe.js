// @flow
import chalk from 'chalk';
import emphasize from 'emphasize';
import type {DiagnosticCodeHighlight} from '@parcel/diagnostic';

type CodeFramePadding = {|
  before: number,
  after: number
|};

type CodeFrameOptionsInput = {|
  useColor?: boolean,
  maxLines?: number,
  padding?: CodeFramePadding,
  syntaxHighlighting?: boolean,
  language?: string
|};

type CodeFrameOptions = {|
  useColor: boolean,
  syntaxHighlighting: boolean,
  maxLines: number,
  padding: CodeFramePadding,
  language?: string
|};

const NEWLINE = /\r\n|[\n\r\u2028\u2029]/;

const highlightSyntax = (line: string, lang?: string): string => {
  if (lang) {
    try {
      return emphasize.highlight(lang, line).value;
    } catch (e) {
      // fallback for unknown languages...
    }
  }

  return emphasize.highlightAuto(line).value;
};

export default function codeFrame(
  code: string,
  highlights: Array<DiagnosticCodeHighlight>,
  // $FlowFixMe
  inputOpts: CodeFrameOptionsInput = {}
): string {
  if (highlights.length < 1) return '';

  let opts: CodeFrameOptions = {
    useColor: !!inputOpts.useColor,
    syntaxHighlighting: !!inputOpts.syntaxHighlighting,
    language: inputOpts.language,
    maxLines: inputOpts.maxLines !== undefined ? inputOpts.maxLines : 12,
    padding: inputOpts.padding || {
      before: 1,
      after: 2
    }
  };

  const highlighter = (s: string, bold?: boolean) => {
    if (opts.useColor) {
      let redString = chalk.red(s);
      return bold ? chalk.bold(redString) : redString;
    }

    return s;
  };

  const lineNumberPrefixer = (params: {|
    lineNumber?: string,
    endLine: string,
    isHighlighted: boolean
  |}) => {
    let {lineNumber, endLine, isHighlighted} = params;

    return `${isHighlighted ? highlighter('>') : ' '} ${
      lineNumber
        ? lineNumber.padEnd(endLine.length, ' ')
        : ' '.repeat(endLine.length)
    } | `;
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

  let firstHighlight =
    highlights.length > 1
      ? highlights.sort((a, b) => a.start.line - b.start.line)[0]
      : highlights[0];
  let lastHighlight =
    highlights.length > 1
      ? highlights.sort((a, b) => b.end.line - a.end.line)[0]
      : highlights[0];

  let startLine = firstHighlight.start.line - opts.padding.before;
  startLine = startLine < 0 ? 0 : startLine;
  let endLine = lastHighlight.end.line + opts.padding.after;
  endLine =
    endLine - startLine > opts.maxLines
      ? startLine + opts.maxLines - 1
      : endLine;
  let endLineString = endLine.toString(10);

  let resultLines = [];
  const lines = code.split(NEWLINE);
  for (let i = startLine; i < lines.length; i++) {
    if (i > endLine) break;

    let originalLine = lines[i];

    let foundHighlights = highlights.filter(
      highlight => highlight.start.line <= i && highlight.end.line >= i
    );

    let highlighted: string = originalLine;
    if (opts.syntaxHighlighting) {
      highlighted = highlightSyntax(originalLine, opts.language);
    }

    resultLines.push(
      lineNumberPrefixer({
        lineNumber: (i + 1).toString(10),
        endLine: endLineString,
        isHighlighted: foundHighlights.length > 0
      }) + highlighted
    );

    if (foundHighlights.length > 0) {
      let highlightLine = lineNumberPrefixer({
        endLine: endLineString,
        isHighlighted: true
      });

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
            highlightLine +=
              ' ' + highlighter(lastHighlightForColumn.message, true);
          }
        }
      }

      resultLines.push(highlightLine);
    }
  }

  return resultLines.join('\n');
}
