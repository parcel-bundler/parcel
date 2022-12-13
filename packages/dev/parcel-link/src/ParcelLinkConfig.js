// @flow

import fs from 'fs';
// $FlowFixMe[untyped-import]
import glob from 'glob';
import nullthrows from 'nullthrows';
import path from 'path';

export class ParcelLinkConfig {
  appRoot: string;
  packageRoot: string;
  namespace: string = '@parcel';
  nodeModulesGlobs: string[] = ['node_modules'];

  static async load(filepath: string): Promise<ParcelLinkConfig> {
    return ParcelLinkConfig.parse(await fs.promises.readFile(filepath, 'utf8'));
  }

  static parse(manifest: string): ParcelLinkConfig {
    return new ParcelLinkConfig(JSON.parse(manifest));
  }

  constructor(options: {|
    appRoot: string,
    packageRoot: string,
    namespace?: string,
    nodeModulesGlobs?: string[],
  |}) {
    this.appRoot = nullthrows(options.appRoot, 'appRoot is required');
    this.packageRoot = nullthrows(
      options.packageRoot,
      'packageRoot is required',
    );
    this.namespace = options.namespace ?? this.namespace;
    this.nodeModulesGlobs = options.nodeModulesGlobs ?? this.nodeModulesGlobs;
  }

  validateAppRoot() {
    try {
      fs.accessSync(path.join(this.appRoot, 'yarn.lock'));
    } catch (e) {
      throw new Error(`Not a root: '${this.appRoot}'`);
    }
  }

  validatePackageRoot() {
    try {
      fs.accessSync(path.join(this.packageRoot, 'core/core'));
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
