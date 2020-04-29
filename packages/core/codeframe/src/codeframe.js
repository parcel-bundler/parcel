// @flow
import type {DiagnosticCodeHighlight} from '@parcel/diagnostic';

import chalk from 'chalk';
import emphasize from 'emphasize';
import stringWidth from 'string-width';
import {splitAnsi} from './ansi-utils';

type CodeFramePadding = {|
  before: number,
  after: number,
|};

type CodeFrameOptionsInput = {
  useColor?: boolean,
  maxLines?: number,
  padding?: CodeFramePadding,
  syntaxHighlighting?: boolean,
  language?: string,
  terminalWidth?: number,
  ...
};

type CodeFrameOptions = {|
  useColor: boolean,
  syntaxHighlighting: boolean,
  maxLines: number,
  padding: CodeFramePadding,
  terminalWidth?: number,
  language?: string,
|};

const NEWLINE = /\r\n|[\n\r\u2028\u2029]/;
const TAB_REPLACE_REGEX = /\t/g;
const TAB_REPLACEMENT = '  ';

const highlightSyntax = (txt: string, lang?: string): string => {
  if (lang) {
    try {
      // Figure out a way to get this mapped to the original line...
      return emphasize.highlight(lang, txt).value;
    } catch (e) {
      // fallback for unknown languages...
    }
  }

  return emphasize.highlightAuto(txt).value;
};

export default function codeFrame(
  code: string,
  highlights: Array<DiagnosticCodeHighlight>,
  inputOpts: CodeFrameOptionsInput = {},
): string {
  if (highlights.length < 1) return '';

  let opts: CodeFrameOptions = {
    useColor: !!inputOpts.useColor,
    syntaxHighlighting: !!inputOpts.syntaxHighlighting,
    language: inputOpts.language,
    maxLines: inputOpts.maxLines !== undefined ? inputOpts.maxLines : 12,
    // If terminal width is undefined, don't split up lines
    terminalWidth: inputOpts.terminalWidth,
    padding: inputOpts.padding || {
      before: 1,
      after: 2,
    },
  };

  // Highlights messages and prefixes when colors are enabled
  const highlighter = (s: string, bold?: boolean) => {
    if (opts.useColor) {
      let redString = chalk.red(s);
      return bold ? chalk.bold(redString) : redString;
    }

    return s;
  };

  // Prefix lines with the line number
  const lineNumberPrefixer = (params: {|
    lineNumber?: string,
    endLine: string,
    isHighlighted: boolean,
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
        line: h.start.line - 1,
      },
      end: {
        column: h.end.column - 1,
        line: h.end.line - 1,
      },
      message: h.message,
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
  let endLine = lastHighlight.end.line + opts.padding.after;
  endLine =
    endLine - startLine > opts.maxLines
      ? startLine + opts.maxLines - 1
      : endLine;
  let endLineString = endLine.toString(10);

  // Split input into lines and highlight syntax
  let lines = code.split(NEWLINE);
  let syntaxHighlightedLines = (opts.syntaxHighlighting
    ? highlightSyntax(code, opts.language)
    : code
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
    if (currentLineIndex > endLine) break;
    if (currentLineIndex > syntaxHighlightedLines.length - 1) break;

    // Find highlights that need to get rendered on the current line
    let foundHighlights = highlights
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

    // Split the line into line parts that will fit the provided terminal width
    let lineParts = opts.terminalWidth
      ? splitAnsi(syntaxHighlightedLines[currentLineIndex], opts.terminalWidth)
      : [syntaxHighlightedLines[currentLineIndex]];

    // Check if this line has a full line highlight
    let isWholeLine =
      foundHighlights.length &&
      !!foundHighlights.find(
        h => h.start.line < currentLineIndex && h.end.line > currentLineIndex,
      );

    let colOffset = 0;
    for (let linePart of lineParts) {
      // Write the syntax highlighted line part
      resultLines.push(
        lineNumberPrefixer({
          lineNumber: (currentLineIndex + 1).toString(10),
          endLine: endLineString,
          isHighlighted: foundHighlights.length > 0,
        }) + linePart,
      );

      if (foundHighlights.length > 0) {
        // Get real width of the highlighted line part
        let linePartWidth = stringWidth(linePart);

        let highlightLine = isWholeLine
          ? highlighter('^'.repeat(linePartWidth))
          : '';
        if (!isWholeLine) {
          // Get all highlights that should be rendered under this line part
          let linePartHighlights = foundHighlights.filter(
            h =>
              h.end.line > currentLineIndex ||
              (h.end.line === currentLineIndex && h.end.column >= colOffset),
          );

          let lastCol = 0;
          let highlight = null;
          for (
            let partHighlightIndex = 0;
            partHighlightIndex < linePartHighlights.length;
            partHighlightIndex++
          ) {
            // Set highlight to current highlight
            highlight = linePartHighlights[partHighlightIndex];

            // Calculate the startColumn and get the real width by doing a substring of the original
            // line and replacing tabs with our tab replacement to support tab handling
            let startCol =
              highlight.start.line === currentLineIndex &&
              highlight.start.column > colOffset
                ? lines[currentLineIndex]
                    .substring(colOffset, highlight.start.column)
                    .replace(TAB_REPLACE_REGEX, TAB_REPLACEMENT).length
                : 0;

            // Calculate the endColumn and get the real width by doing a substring of the original
            // line and replacing tabs with our tab replacement to support tab handling
            let endCol =
              highlight.end.line === currentLineIndex
                ? lines[currentLineIndex]
                    .substring(colOffset, highlight.end.column)
                    .replace(TAB_REPLACE_REGEX, TAB_REPLACEMENT).length
                : linePartWidth - 1;

            // If endcol is smaller than lastCol it overlaps with another highlight and is no longer visible, we can skip those
            if (endCol >= lastCol) {
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
              highlightLine += highlighter('^'.repeat(characters));

              // Set the lastCol equal to character count between start of line part and highlight end-column
              lastCol = endCol + 1;
            }
          }

          if (
            highlight &&
            highlight.message &&
            highlight.end.line === currentLineIndex
          ) {
            highlightLine += ' ' + highlighter(highlight.message, true);
          }
        }

        if (highlightLine) {
          resultLines.push(
            lineNumberPrefixer({
              endLine: endLineString,
              isHighlighted: true,
            }) + highlightLine,
          );
        }

        colOffset += linePartWidth;
      }
    }
  }

  return resultLines.join('\n');
}
