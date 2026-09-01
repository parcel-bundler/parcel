// @flow strict-local

import type {PackageInstaller, InstallerOptions} from '@parcel/types';

import commandExists from 'command-exists';
import spawn from 'cross-spawn';
import logger from '@parcel/logger';
import promiseFromProcess from './promiseFromProcess';
import {registerSerializableClass} from '@parcel/core';
import {npmSpecifierFromModuleRequest} from './utils';

// $FlowFixMe
import pkg from '../package.json';

const BUN_CMD = 'bun';

let hasBun: ?boolean;

export class Bun implements PackageInstaller {
  static async exists(): Promise<boolean> {
    if (hasBun != null) {
      return hasBun;
    }

    try {
      hasBun = Boolean(await commandExists('bun'));
    } catch (err) {
      hasBun = false;
    }

    return hasBun;
  }

  async install({
    modules,
    cwd,
    saveDev = true,
  }: InstallerOptions): Promise<void> {
    let args = ['add'];
    if (saveDev) {
      args.push('--dev');
    }
    args = args.concat(modules.map(npmSpecifierFromModuleRequest));

    // Bun reads the same npm_config_* environment variables as npm/yarn, and
    // forwarding them when Parcel itself was invoked via a package manager
    // script can cause it to behave unexpectedly, so filter them out (as the
    // other installers do) when installing packages.
    let env = {};
    for (let key in process.env) {
      if (!key.startsWith('npm_') && key !== 'INIT_CWD' && key !== 'NODE_ENV') {
        env[key] = process.env[key];
      }
    }

    let installProcess = spawn(BUN_CMD, args, {cwd, env});

    let stderr = [];
    installProcess.stderr.on('data', (buf: Buffer) => {
      stderr.push(buf.toString().trim());
    });

    try {
      await promiseFromProcess(installProcess);

      for (let message of stderr) {
        if (message.length > 0) {
          logger.log({
            origin: '@parcel/package-manager',
            message,
          });
        }
      }
    } catch (e) {
      throw new Error(
        'bun failed to install modules: ' +
          e.message +
          ' - ' +
          stderr.join('\n'),
      );
    }
  }
}

registerSerializableClass(`${pkg.version}:Bun`, Bun);
