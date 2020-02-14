// @flow strict-local

import type {PackageInstaller, InstallerOptions} from './types';

import fs from 'fs';
import path from 'path';
import spawn from 'cross-spawn';
import logger from '@parcel/logger';
import promiseFromProcess from './promiseFromProcess';
import {registerSerializableClass} from '@parcel/core';
import {npmSpecifierFromModuleRequest} from './utils';

// $FlowFixMe
import pkg from '../package.json';

const NPM_CMD = 'npm';

export class Npm implements PackageInstaller {
  async install({
    modules,
    cwd,
    packagePath,
    saveDev = true,
  }: InstallerOptions): Promise<void> {
    // npm doesn't auto-create a package.json when installing,
    // so create an empty one if needed.
    if (packagePath == null) {
      await fs.writeFile(path.join(cwd, 'package.json'), '{}');
    }

    let args = ['install', '--json', saveDev ? '--save-dev' : '--save'].concat(
      modules.map(npmSpecifierFromModuleRequest),
    );

    let installProcess = spawn(NPM_CMD, args, {cwd});
    let stdout = '';
    installProcess.stdout.on('data', str => {
      stdout += str;
    });

    let stderr = [];
    installProcess.stderr.on('data', str => {
      stderr.push(str);
    });

    try {
      await promiseFromProcess(installProcess);

      let results: NPMResults = JSON.parse(stdout);
      let addedCount = results.added.length;
      if (addedCount > 0) {
        logger.log({
          origin: '@parcel/package-manager',
          message: `Added ${addedCount} packages via npm`,
        });
      }

      // Since we succeeded, stderr might have useful information not included
      // in the json written to stdout. It's also not necessary to log these as
      // errors as they often aren't.
      for (let message of stderr) {
        logger.log({
          origin: '@parcel/package-manager',
          message,
        });
      }
    } catch (e) {
      throw new Error('npm failed to install modules');
    }
  }
}

type NPMResults = {|
  added: Array<{name: string, ...}>,
|};

registerSerializableClass(`${pkg.version}:Npm`, Npm);
