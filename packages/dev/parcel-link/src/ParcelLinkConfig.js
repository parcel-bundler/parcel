// @flow

import type {FileSystem} from '@parcel/fs';

// $FlowFixMe[untyped-import]
import assert from 'assert';
import glob from 'glob';
import nullthrows from 'nullthrows';
import path from 'path';
import {NodeFS} from '@parcel/fs';

export class ParcelLinkConfig {
  appRoot: string;
  packageRoot: string;
  fs: FileSystem;
  namespace: string = '@parcel';
  nodeModulesGlobs: string[] = ['node_modules'];
  filename: string = '.parcel-link';

  static load(
    appRoot: string,
    options?: {|filename?: string, fs?: FileSystem|},
  ): ParcelLinkConfig {
    let {fs = new NodeFS(), filename = '.parcel-link'} = options ?? {};
    let manifest = JSON.parse(
      fs.readFileSync(path.join(appRoot, filename), 'utf8'),
    );
    return new ParcelLinkConfig({...manifest, fs});
  }

  constructor(options: {|
    appRoot: string,
    packageRoot: string,
    namespace?: string,
    nodeModulesGlobs?: string[],
    fs?: FileSystem,
    filename?: string,
  |}) {
    this.appRoot = nullthrows(options.appRoot, 'appRoot is required');
    this.packageRoot = nullthrows(
      options.packageRoot,
      'packageRoot is required',
    );
    this.namespace = options.namespace ?? this.namespace;
    this.nodeModulesGlobs = options.nodeModulesGlobs ?? this.nodeModulesGlobs;
    this.filename = options.filename ?? this.filename;
    this.fs = options.fs ?? new NodeFS();
  }

  async save(): Promise<void> {
    return this.fs.writeFile(
      path.join(this.appRoot, this.filename),
      JSON.stringify(this, null, 2),
    );
  }

  async delete(): Promise<void> {
    return this.fs.rimraf(path.join(this.appRoot, this.filename));
  }

  validateAppRoot() {
    try {
      assert(this.fs.existsSync(path.join(this.appRoot, 'yarn.lock')));
    } catch (e) {
      throw new Error(`Not a root: '${this.appRoot}'`);
    }
  }

  validatePackageRoot() {
    try {
      assert(this.fs.existsSync(path.join(this.packageRoot, 'core/core')));
    } catch (e) {
      throw new Error(`Not a package root: '${this.packageRoot}'`);
    }
  }

  validate(): void {
    this.validateAppRoot();
    this.validatePackageRoot();
  }

  getNodeModulesPaths(): string[] {
    return this.nodeModulesGlobs.reduce(
      (matches, pattern) => [
        ...matches,
        ...glob.sync(pattern, {cwd: this.appRoot}),
      ],
      [],
    );
  }

  toJson(): {|
    appRoot: string,
    packageRoot: string,
    namespace: string,
    nodeModulesGlobs: string[],
  |} {
    return {
      appRoot: this.appRoot,
      packageRoot: this.packageRoot,
      namespace: this.namespace,
      nodeModulesGlobs: this.nodeModulesGlobs,
    };
  }
}
