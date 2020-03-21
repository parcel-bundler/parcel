// @flow strict-local

declare module "@babel/generator" {
  import type { Node } from "@babel/types";

  declare export type SourceMap = {|
    version: number,
    sources: Array<string>,
    names: Array<string>,
    mappings: string,
    sourcesContent: Array<string>,
  |};

  declare export type Options = {|
    auxiliaryCommentBefore?: string,
    auxiliaryCommentAfter?: string,
    shouldPrintComment?: function,
    retainLines?: boolean,
    retainFunctionParens?: boolean,
    comments?: boolean,
    compact?: boolean | "auto",
    minified?: boolean,
    concise?: boolean,
    filename?: string,
    jsonCompatibleStrings?: boolean,
    sourceMaps?: boolean,
    sourceRoot?: string,
    sourceFileName?: string,
  |};

  declare export default (
    ast: Node,
    opts?: Options,
    source?: string
  ) => {| code: string, map: ?any, rawMappings: ?any |};
}
