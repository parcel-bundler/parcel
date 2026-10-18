// Stylus internals that are not covered by @types/stylus.
// AST nodes are left untyped.

declare module 'stylus/lib/parser' {
  class Parser {
    constructor(str: string, options: object);
    parse(): any;
  }
  export = Parser;
}

declare module 'stylus/lib/visitor/deps-resolver' {
  class DepsResolver {
    constructor(root: any, options: object);
    visit(node: any): any;
    visitImport(node: any): any;
  }
  export = DepsResolver;
}

declare module 'stylus/lib/visitor/evaluator' {
  class Evaluator {
    constructor(root: any, options: object);
    visit(node: any): any;
    visitImport(node: any): any;
  }
  export = Evaluator;
}

declare module 'stylus/lib/nodes/index' {
  const nodes: {filename: string | null};
  export = nodes;
}

declare module 'stylus/lib/utils' {
  export function find(
    path: string,
    paths: Array<string>,
    ignore?: string,
  ): Array<string> | undefined;
  export function lookupIndex(
    name: string,
    paths: Array<string>,
    filename?: string,
  ): Array<string> | undefined;
}
