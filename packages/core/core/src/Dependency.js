// @flow
import type {
  DependencyOptions,
  Dependency as IDependency,
  Environment as IEnvironment,
  SourceLocation,
  Meta,
  Target,
  ModuleSpecifier,
  FilePath,
  Symbol
} from '@parcel/types';
import {md5FromString} from '@parcel/utils';

type DependencyOpts = {|
  ...DependencyOptions,
  env: IEnvironment,
  id?: string,
  sourcePath?: FilePath
|};

export default class Dependency implements IDependency {
  id: string;
  moduleSpecifier: ModuleSpecifier;
  isAsync: ?boolean;
  isEntry: ?boolean;
  isOptional: ?boolean;
  isURL: ?boolean;
  isWeak: ?boolean;
  loc: ?SourceLocation;
  env: IEnvironment;
  meta: Meta;
  target: ?Target;
  sourcePath: ?FilePath;
  symbols: Map<Symbol, Symbol>;

  constructor(opts: DependencyOpts) {
    this.moduleSpecifier = opts.moduleSpecifier;
    this.isAsync = opts.isAsync;
    this.isEntry = opts.isEntry;
    this.isOptional = opts.isOptional;
    this.isURL = opts.isURL;
    this.isWeak = opts.isWeak;
    this.loc = opts.loc;
    this.meta = opts.meta || {};
    this.target = opts.target;
    this.env = opts.env;
    this.sourcePath = opts.sourcePath || ''; // TODO: get from graph?
    this.symbols = new Map(opts.symbols || []);
    this.id =
      opts.id ||
      md5FromString(
        `${this.sourcePath}:${this.moduleSpecifier}:${JSON.stringify(this.env)}`
      );
  }

  merge(other: IDependency) {
    Object.assign(this.meta, other.meta);
    this.symbols = new Map([...this.symbols, ...other.symbols]);
  }

  serialize() {
    return {
      moduleSpecifier: this.moduleSpecifier,
      isAsync: this.isAsync,
      isEntry: this.isEntry,
      isOptional: this.isOptional,
      isURL: this.isURL,
      isWeak: this.isWeak,
      loc: this.loc,
      meta: this.meta,
      target: this.target,
      env: this.env,
      sourcePath: this.sourcePath,
      symbols: [...this.symbols],
      id: this.id
    };
  }
}
