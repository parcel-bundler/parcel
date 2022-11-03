// @flow strict-local

declare module "@babel/template" {
  import type { Program, Expression, Statement, Node } from "@babel/types";
  import type { Options as ParserOptions } from "@babel/parser";

  declare type Options = {|
    ...ParserOptions,
    syntacticPlaceholders?: boolean,
    preserveComments?: boolean,
  |};

  // (R === null) ? () => T : (R) => T
  declare type Template<
    R: null | { +[string]: BabelNode | $ReadOnlyArray<BabelNode>, ... },
    T: BabelNode | Array<Statement>
  > = $Call<(null => () => T) & (({ ... }) => (replacements: R) => T), R>;

  declare module.exports: {|
    <R, T>(code: string, opts?: Options): Template<R, T>,
    smart<R, T>(code: string, opts?: Options): Template<R, T>,
    statement<R, T: Statement>(code: string, opts?: Options): Template<R, T>,
    statements<R>(code: string, opts?: Options): Template<R, Array<Statement>>,
    expression<R, T: Expression>(code: string, opts?: Options): Template<R, T>,
    program<R, T: Program>(code: string, opts?: Options): Template<R, T>,

    ast(code: string): string,
    ast(callSite: Array<string>, ...substitutions: Array<string>): string,
  |};
}
