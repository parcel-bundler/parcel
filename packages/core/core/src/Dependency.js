// @flow
import type {
  DependencyOptions,
  Dependency as IDependency,
  Environment as IEnvironment,
  SourceLocation,
  Meta,
  Target,
  ModuleSpecifier,
  FilePath
} from '@parcel/types';
import {md5FromString} from '@parcel/utils/src/md5';

type DependencyOpts = {|
  ...DependencyOptions,
  moduleSpecifier: ModuleSpecifier,
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
  loc: ?SourceLocation;
  env: IEnvironment;
  meta: ?Meta;
  target: ?Target;
  sourcePath: FilePath;

  constructor(opts: DependencyOpts) {
    this.moduleSpecifier = opts.moduleSpecifier;
    this.isAsync = opts.isAsync;
    this.isEntry = opts.isEntry;
    this.isOptional = opts.isOptional;
    this.isURL = opts.isURL;
    this.loc = opts.loc;
    this.meta = opts.meta;
    this.target = opts.target;
    this.env = opts.env;
    this.sourcePath = opts.sourcePath || ''; // TODO: get from graph?
    this.id =
      opts.id ||
      md5FromString(
        `${this.sourcePath}:${this.moduleSpecifier}:${JSON.stringify(this.env)}`
      );
  }
}
