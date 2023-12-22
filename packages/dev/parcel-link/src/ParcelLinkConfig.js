// @flow

import type {FileSystem} from '@parcel/fs';

import {globSync} from '@parcel/utils';

import assert from 'assert';
import nullthrows from 'nullthrows';
import path from 'path';

const LOCK_FILE_NAMES = ['yarn.lock', 'package-lock.json', 'pnpm-lock.yaml'];
const SCM_FILE_NAMES = ['.git', '.hg'];

export class ParcelLinkConfig {
  fs: FileSystem;
  appRoot: string;
  packageRoot: string;
  namespace: string = '@parcel';
  nodeModulesGlobs: string[] = ['node_modules'];
  filename: string = '.parcel-link';

  static load(
    appRoot: string,
    {fs, filename = '.parcel-link'}: {|fs: FileSystem, filename?: string|},
  ): ParcelLinkConfig {
    let manifest = JSON.parse(
      fs.readFileSync(path.join(appRoot, filename), 'utf8'),
    );
    return new ParcelLinkConfig({...manifest, fs});
  }

  constructor(options: {|
    fs: FileSystem,
    appRoot: string,
    packageRoot: string,
    namespace?: string,
    nodeModulesGlobs?: string[],
    filename?: string,
  |}) {
    this.fs = nullthrows(options.fs, 'fs is required');
    this.appRoot = nullthrows(options.appRoot, 'appRoot is required');
    this.packageRoot = nullthrows(
      options.packageRoot,
      'packageRoot is required',
    );
    this.namespace = options.namespace ?? this.namespace;
    this.nodeModulesGlobs = options.nodeModulesGlobs ?? this.nodeModulesGlobs;
    this.filename = options.filename ?? this.filename;
  }

  save(): Promise<void> {
    return this.fs.writeFile(
      path.join(this.appRoot, this.filename),
      JSON.stringify(this, null, 2),
    );
  }

  delete(): Promise<void> {
    return this.fs.rimraf(path.join(this.appRoot, this.filename));
  }

  validateAppRoot() {
    assert(
      [...LOCK_FILE_NAMES, ...SCM_FILE_NAMES].some(filename =>
        this.fs.existsSync(path.join(this.appRoot, filename)),
      ),
      `Not a project root: '${this.appRoot}'`,
    );
  }

  validatePackageRoot() {
    assert(
      this.fs.existsSync(path.join(this.packageRoot, 'core/core')),
      `Not a package root: '${this.packageRoot}'`,
    );
  }

  validate(): void {
    this.validateAppRoot();
    this.validatePackageRoot();
  }

  getNodeModulesPaths(): string[] {
    return this.nodeModulesGlobs.reduce(
      (matches, pattern) => [
        ...matches,
        ...globSync(pattern, this.fs, {cwd: this.appRoot, onlyFiles: false}),
      ],
      [],
    );
  }

  toJSON(): {|
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
