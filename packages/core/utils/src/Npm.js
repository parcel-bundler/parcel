// @flow strict-local

import type {FilePath} from '@parcel/types';

import fs from 'fs';
import path from 'path';
import spawn from 'cross-spawn';
import logger from '@parcel/logger';

import promiseFromProcess from './promiseFromProcess';

const NPM_CMD = 'npm';

export default class Npm {
  cwd: FilePath;
  packageLocation: ?FilePath;

  constructor({
    cwd,
    packageLocation
  }: {
    cwd: FilePath,
    packageLocation: ?FilePath
  }) {
    this.cwd = cwd;
    this.packageLocation = packageLocation;
  }

  async install(
    modules: Array<string>,
    saveDev: boolean = true
  ): Promise<void> {
    // npm doesn't auto-create a package.json when installing,
    // so create an empty one if needed.
    if (this.packageLocation == null) {
      await fs.writeFile(path.join(this.cwd, 'package.json'), '{}');
    }

    let args = [
      'install',
      '--json',
      ...modules,
      saveDev ? '--save-dev' : '--save'
    ];

    let installProcess = spawn(NPM_CMD, args, {cwd: this.cwd});
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
        logger.log(`Added ${addedCount} packages via npm`);
      }

      // Since we succeeded, stderr might have useful information not included
      // in the json written to stdout. It's also not necessary to log these as
      // errors as they often aren't.
      for (let message of stderr) {
        logger.log(message);
      }
    } catch (e) {
      throw new Error('npm failed to install modules');
    }
  }
}

type NPMResults = {
  added: Array<{name: string}>
};
