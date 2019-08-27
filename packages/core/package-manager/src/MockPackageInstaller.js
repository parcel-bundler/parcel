// @flow

import type {PackageInstaller, InstallerOptions} from './types';
import type {FileSystem} from '@parcel/fs';
import type {FilePath} from '@parcel/types';
import path from 'path';
import {ncp} from '@parcel/fs';
import {registerSerializableClass} from '@parcel/utils';
import pkg from '../package.json';

type Package = {|
  fs: FileSystem,
  packagePath: FilePath
|};

// This PackageInstaller implementation simply copies files from one filesystem to another.
// Mostly useful for testing purposes.
export class MockPackageInstaller implements PackageInstaller {
  packages = new Map<string, Package>();

  register(packageName: string, fs: FileSystem, packagePath: FilePath) {
    this.packages.set(packageName, {fs, packagePath});
  }

  async install({
    modules,
    fs,
    cwd,
    packagePath,
    saveDev = true
  }: InstallerOptions): Promise<void> {
    if (packagePath == null) {
      packagePath = path.join(cwd, 'package.json');
      await fs.writeFile(packagePath, '{}');
    }

    let pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    let key = saveDev ? 'devDependencies' : 'dependencies';

    if (!pkg[key]) {
      pkg[key] = {};
    }

    for (let module of modules) {
      pkg[key][module] =
        '^' + (await this.installPackage(module, fs, packagePath));
    }

    await fs.writeFile(packagePath, JSON.stringify(pkg));
  }

  async installPackage(
    packageName: string,
    fs: FileSystem,
    packagePath: FilePath
  ) {
    let pkg = this.packages.get(packageName);
    if (!pkg) {
      throw new Error('Unknown package ' + packageName);
    }

    let dest = path.join(
      path.dirname(packagePath),
      'node_modules',
      packageName
    );
    await ncp(pkg.fs, pkg.packagePath, fs, dest);

    let packageJSON = JSON.parse(
      await fs.readFile(path.join(dest, 'package.json'), 'utf8')
    );
    let deps = packageJSON.dependencies || {};
    for (let dep in deps) {
      await this.installPackage(dep, fs, packagePath);
    }

    return packageJSON.version;
  }
}

registerSerializableClass(
  `${pkg.version}:MockPackageInstaller`,
  MockPackageInstaller
);
