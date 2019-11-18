// @flow

export type Import = {|specifier: string, imported: string|};
export type Export =
  | {|name: string, imported: string, specifier?: ?string|}
  | {|specifier: string|};

export class TSModule {
  imports: Map<string, Import>;
  exports: Array<Export>;
  bindings: Map<string, any>;
  names: Map<string, string>;
  used: Set<string>;

  constructor() {
    this.imports = new Map();
    this.exports = [];
    this.bindings = new Map();
    this.names = new Map();
    this.used = new Set();
  }

  addImport(local: string, specifier: string, imported: string) {
    this.imports.set(local, {specifier, imported});
    if (imported !== '*' && imported !== 'default') {
      this.names.set(local, imported);
    }
  }

  addExport(name: string, imported: string, specifier: ?string) {
    this.exports.push({name, specifier, imported});
  }

  addWildcardExport(specifier: string) {
    this.exports.push({specifier});
  }

  addLocal(name: string, node: any) {
    this.bindings.set(name, node);
    if (name !== 'default') {
      this.names.set(name, name);
    }
  }

  getName(name: string) {
    return this.names.get(name) || name;
  }

  hasBinding(name: string) {
    return this.bindings.has(name);
  }
}
