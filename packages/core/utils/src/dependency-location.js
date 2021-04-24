// @flow
export default function createDependencyLocation(
  start: {
    line: number,
    column: number,
    ...
  },
  filePath: string,
  moduleSpecifier: string,
  lineOffset: number = 0,
  columnOffset: number = 0,
  // Imports are usually wrapped in quotes
  importWrapperLength: number = 2,
): {|
  end: {|column: number, line: number|},
  filePath: string,
  start: {|column: number, line: number|},
|} {
  return {
    filePath,
    start: {
      line: start.line + lineOffset,
      column: start.column + columnOffset,
    },
    end: {
      line: start.line + lineOffset,
      column:
        start.column +
        moduleSpecifier.length -
        1 +
        importWrapperLength +
        columnOffset,
    },
  };
}
