// @flow
import type {DiagnosticCodeHighlight, TextEdit} from '@parcel/diagnostic';

import chalk from 'chalk';
import emphasize from 'emphasize';
import stringWidth from 'string-width';
import sliceAnsi from 'slice-ansi';
import type {Diagnostic} from 'typescript';

type CodeFramePadding = {|
  before: number,
  after: number,
|};

type CodeFrameOptionsInput = $Shape<CodeFrameOptions>;

type CodeFrameOptions = {|
  useColor: boolean,
  syntaxHighlighting: boolean,
  maxLines: number,
  padding: CodeFramePadding,
  terminalWidth: number,
  language?: string,
|};

const NEWLINE = /\r\n|[\n\r\u2028\u2029]/;
const TAB_REPLACE_REGEX = /\t/g;
const TAB_REPLACEMENT = '  ';
const DEFAULT_TERMINAL_WIDTH = 80;

const highlightSyntax = (txt: string, lang?: string): string => {
  if (lang) {
    try {
      return emphasize.highlight(lang, txt).value;
    } catch (e) {
      // fallback for unknown languages...
    }
  }

  return emphasize.highlightAuto(txt).value;
};

type Highlight = {|
  ...DiagnosticCodeHighlight,
  replacement?: string,
|};

export default function codeFrame(
  code: string,
  highlights: Array<Highlight>,
  inputOpts: CodeFrameOptionsInput = {},
): string {
  if (highlights.length < 1) return '';

  let opts: CodeFrameOptions = {
    useColor: !!inputOpts.useColor,
    syntaxHighlighting: !!inputOpts.syntaxHighlighting,
    language: inputOpts.language,
    maxLines: inputOpts.maxLines ?? 12,
    terminalWidth: inputOpts.terminalWidth || DEFAULT_TERMINAL_WIDTH,
    padding: inputOpts.padding || {
      before: 1,
      after: 2,
    },
  };

  // Highlights messages and prefixes when colors are enabled
  const highlighter = (
    s: string,
    bold?: boolean,
    kind?: 'negative' | 'positive' = 'negative',
  ) => {
    if (opts.useColor) {
      let colorString = kind === 'positive' ? chalk.green(s) : chalk.red(s);
      return bold ? chalk.bold(colorString) : colorString;
    }

    return s;
  };

  // Prefix lines with the line number
  const lineNumberPrefixer = (params: {|
    lineNumber?: string,
    lineNumberLength: number,
    prefix?: string,
  |}) => {
    let {lineNumber, lineNumberLength, prefix} = params;

    return `${prefix || ' '} ${
      lineNumber
        ? lineNumber.padStart(lineNumberLength, ' ')
        : ' '.repeat(lineNumberLength)
    } | `;
  };

  // Make columns/lines start at 1
  let originalHighlights = highlights;
  highlights = highlights.map(h => {
    return {
      start: {
        column: h.start.column - 1,
        line: h.start.line - 1,
      },
      end: {
        column: h.end.column - 1,
        line: h.end.line - 1,
      },
      message: h.message,
      replacement: h.replacement,
    };
  });

  // Find first and last highlight
  let firstHighlight =
    highlights.length > 1
      ? highlights.sort((a, b) => a.start.line - b.start.line)[0]
      : highlights[0];
  let lastHighlight =
    highlights.length > 1
      ? highlights.sort((a, b) => b.end.line - a.end.line)[0]
      : highlights[0];

  // Calculate first and last line index of codeframe
  let startLine = firstHighlight.start.line - opts.padding.before;
  startLine = startLine < 0 ? 0 : startLine;
  let endLineIndex = lastHighlight.end.line + opts.padding.after;
  let tail;
  if (endLineIndex - startLine > opts.maxLines) {
    let maxLine = startLine + opts.maxLines - 1;
    highlights = highlights.filter(h => h.start.line < maxLine);
    lastHighlight = highlights[0];
    endLineIndex = Math.min(
      maxLine,
      lastHighlight.end.line + opts.padding.after,
    );
    tail = originalHighlights.filter(h => h.start.line > endLineIndex);
  }

  let lineNumberLength = (endLineIndex + 1).toString(10).length;

  // Split input into lines and highlight syntax
  let lines = code.split(NEWLINE);
  let syntaxHighlightedLines = (
    opts.syntaxHighlighting ? highlightSyntax(code, opts.language) : code
  )
    .replace(TAB_REPLACE_REGEX, TAB_REPLACEMENT)
    .split(NEWLINE);

  // Loop over all lines and create codeframe
  let resultLines = [];
  for (
    let currentLineIndex = startLine;
    currentLineIndex < syntaxHighlightedLines.length;
    currentLineIndex++
  ) {
    if (currentLineIndex > endLineIndex) break;
    if (currentLineIndex > syntaxHighlightedLines.length - 1) break;

    // Find highlights that need to get rendered on the current line
    let lineHighlights = highlights
      .filter(
        highlight =>
          highlight.start.line <= currentLineIndex &&
          highlight.end.line >= currentLineIndex,
      )
      .sort(
        (a, b) =>
          (a.start.line < currentLineIndex ? 0 : a.start.column) -
          (b.start.line < currentLineIndex ? 0 : b.start.column),
      );

    // Check if this line has a full line highlight
    let isWholeLine =
      lineHighlights.length &&
      !!lineHighlights.find(
        h => h.start.line < currentLineIndex && h.end.line > currentLineIndex,
      );

    let lineLengthLimit =
      opts.terminalWidth > lineNumberLength + 7
        ? opts.terminalWidth - (lineNumberLength + 5)
        : 10;

    // Split the line into line parts that will fit the provided terminal width
    let colOffset = 0;
    let lineEndCol = lineLengthLimit;
    let syntaxHighlightedLine = syntaxHighlightedLines[currentLineIndex];
    if (stringWidth(syntaxHighlightedLine) > lineLengthLimit) {
      if (lineHighlights.length > 0) {
        if (lineHighlights[0].start.line === currentLineIndex) {
          colOffset = lineHighlights[0].start.column - 5;
        } else if (lineHighlights[0].end.line === currentLineIndex) {
          colOffset = lineHighlights[0].end.column - 5;
        }
      }

      colOffset = colOffset > 0 ? colOffset : 0;
      lineEndCol = colOffset + lineLengthLimit;

      syntaxHighlightedLine = sliceAnsi(
        syntaxHighlightedLine,
        colOffset,
        lineEndCol,
      );
    }

    let hasReplacement = lineHighlights.some(
      highlight => highlight.replacement != null,
    );
    let prefix = '>';

    if (hasReplacement) {
      let line = lines[currentLineIndex];
      let deletedLine = '';
      let hasHighlighted = false;
      let start = 0;
      for (let highlight of lineHighlights) {
        let highlightStart =
          highlight.start.line === currentLineIndex
            ? highlight.start.column
            : 0;
        let highlightEnd =
          highlight.end.line === currentLineIndex
            ? highlight.end.column + 1
            : line.length;
        let highlighted = line.slice(highlightStart, highlightEnd);
        hasHighlighted = hasHighlighted || highlighted.length > 0;
        deletedLine += highlighter(
          line.slice(start, highlightStart),
          false,
          'negative',
        );
        deletedLine += highlighter(
          chalk.redBright(highlighted),
          true,
          'negative',
        );
        start = highlightEnd;
      }

      deletedLine += highlighter(line.slice(start), false, 'negative');

      if (hasHighlighted) {
        prefix = '-';
        syntaxHighlightedLine = deletedLine;
      } else {
        prefix = '';
      }
    }

    // Write the syntax highlighted line part
    if (prefix) {
      resultLines.push(
        lineNumberPrefixer({
          lineNumber: (currentLineIndex + 1).toString(10),
          lineNumberLength,
          prefix: lineHighlights.length > 0 ? highlighter(prefix) : '',
        }) + syntaxHighlightedLine,
      );
    }

    prefix = hasReplacement
      ? highlighter('+', false, 'positive')
      : highlighter('>');

    let lineWidth = stringWidth(syntaxHighlightedLine);
    let highlightLine = '';
    if (isWholeLine) {
      highlightLine = highlighter('^'.repeat(lineWidth));
    } else if (lineHighlights.length > 0) {
      let lastCol = 0;
      let highlight = null;
      let highlightHasEnded = false;

      for (
        let highlightIndex = 0;
        highlightIndex < lineHighlights.length;
        highlightIndex++
      ) {
        // Set highlight to current highlight
        highlight = lineHighlights[highlightIndex];
        highlightHasEnded = false;

        // Calculate the startColumn and get the real width by doing a substring of the original
        // line and replacing tabs with our tab replacement to support tab handling
        let startCol = 0;
        if (
          highlight.start.line === currentLineIndex &&
          highlight.start.column > colOffset
        ) {
          startCol = lines[currentLineIndex]
            .substring(colOffset, highlight.start.column)
            .replace(TAB_REPLACE_REGEX, TAB_REPLACEMENT).length;
        }

        // Calculate the endColumn and get the real width by doing a substring of the original
        // line and replacing tabs with our tab replacement to support tab handling
        let endCol = lineWidth - 1;
        if (highlight.end.line === currentLineIndex) {
          endCol = lines[currentLineIndex]
            .substring(colOffset, highlight.end.column)
            .replace(TAB_REPLACE_REGEX, TAB_REPLACEMENT).length;

          // If the endCol is too big for this line part, trim it so we can handle it in the next one
          if (endCol > lineWidth) {
            endCol = lineWidth - 1;
          }

          highlightHasEnded = true;
        }

        // If endcol is smaller than lastCol it overlaps with another highlight and is no longer visible, we can skip those
        if (endCol >= lastCol) {
          let replacement = highlight.replacement;
          if (replacement != null) {
            highlightLine += highlighter(
              lines[currentLineIndex].slice(0, startCol),
              false,
              'positive',
            );

            let replacementLines = replacement.split('\n');
            if (replacementLines.length === 1) {
              highlightLine += highlighter(
                chalk.greenBright(replacementLines[0]),
                true,
                'positive',
              );

              highlightLine += highlighter(
                lines[currentLineIndex].slice(endCol + 1),
                false,
                'positive',
              );
            } else {
              for (let i = 0; i < replacementLines.length; i++) {
                highlightLine += highlighter(
                  chalk.greenBright(replacementLines[i]),
                  false,
                  'positive',
                );
                if (i < replacementLines.length - 1) {
                  resultLines.push(
                    lineNumberPrefixer({
                      lineNumberLength,
                      prefix: highlighter('+', false, 'positive'),
                    }) + highlightLine,
                  );
                  highlightLine = '';
                }
              }

              highlightLine += sliceAnsi(
                syntaxHighlightedLines[currentLineIndex],
                endCol + 1,
              );
              resultLines.push(
                lineNumberPrefixer({
                  lineNumber: (currentLineIndex + 1).toString(10),
                  lineNumberLength,
                }) + highlightLine,
              );
              highlightLine = '';
            }
          } else {
            let characters = endCol - startCol + 1;
            if (startCol > lastCol) {
              // startCol is before lastCol, so add spaces as padding before the highlight indicators
              highlightLine += ' '.repeat(startCol - lastCol);
            } else if (lastCol > startCol) {
              // If last column is larger than the start, there's overlap in highlights
              // This line adjusts the characters count to ensure we don't add too many characters
              characters += startCol - lastCol;
            }

            // Append the highlight indicators
            if (highlight.replacement != null) {
              highlightLine += highlight.replacement;
            } else {
              highlightLine += highlighter('^'.repeat(characters));
            }
          }

          // Set the lastCol equal to character count between start of line part and highlight end-column
          lastCol = endCol + 1;
        }

        // There's no point in processing more highlights if we reached the end of the line
        if (endCol >= lineEndCol - 1) {
          break;
        }
      }

      // Append the highlight message if the current highlights ends on this line part
      if (highlight && highlight.message && highlightHasEnded) {
        highlightLine += ' ' + highlighter(highlight.message, true);
      }
    }

    if (highlightLine) {
      resultLines.push(
        lineNumberPrefixer({
          lineNumberLength,
          prefix,
        }) + highlightLine,
      );
    }
  }

  let result = resultLines.join('\n');

  if (tail && tail.length > 0) {
    result += '\n\n' + codeFrame(code, tail, inputOpts);
  }

  return result;
}

export function formatDiff(
  code: string,
  edits: Array<TextEdit>,
  inputOpts: CodeFrameOptionsInput = {},
): string {
  let highlights = edits.map(edit => ({
    start: edit.range.start,
    end: edit.range.end,
    replacement: edit.replacement,
  }));

  return codeFrame(code, highlights, inputOpts);
}
