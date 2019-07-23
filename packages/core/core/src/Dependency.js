// @flow
import type {
  DependencyOptions,
  Dependency as IDependency,
  Environment as IEnvironment,
  FilePath,
  SourceLocation,
  Meta,
  Target,
  ModuleSpecifier,
  Symbol
} from '@parcel/types';
import {md5FromString} from '@parcel/utils';

type DependencyOpts = {|
  ...DependencyOptions,
  env: IEnvironment,
  id?: string,
  sourcePath?: string,
  sourceAssetId?: string
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
  sourceAssetId: ?string;
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
    this.sourceAssetId = opts.sourceAssetId;
    this.sourcePath = opts.sourcePath;
    this.symbols = opts.symbols || new Map();
    this.id =
      opts.id ||
      md5FromString(
        `${this.sourceAssetId ?? ''}:${this.moduleSpecifier}:${JSON.stringify(
          this.env
        )}`
      );
  }

  merge(other: IDependency) {
    Object.assign(this.meta, other.meta);
    this.symbols = new Map([...this.symbols, ...other.symbols]);
  }
}
