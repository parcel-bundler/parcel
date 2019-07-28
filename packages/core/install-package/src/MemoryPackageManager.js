// @flow

import type {PackageManager, InstallOptions} from './types';
import path from 'path';

export default class MemoryPackageManager implements PackageManager {
  async install({
    modules,
    fs,
    cwd,
    packagePath,
    saveDev = true
  }: InstallOptions): Promise<void> {
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
      pkg[key][module] = '*';
    }

    await fs.writeFile(packagePath, JSON.stringify(pkg));
  }
}
