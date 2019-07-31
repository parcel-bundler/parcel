// @flow

import type {FilePath} from '@parcel/types';

import WorkerFarm from '@parcel/workers';
import logger from '@parcel/logger';
import path from 'path';
import nullthrows from 'nullthrows';
import {NodeFS} from '@parcel/fs';

import {loadConfig, PromiseQueue, resolve, resolveConfig} from '@parcel/utils';
import Npm from './Npm';
import Yarn from './Yarn';

type InstallOptions = {
  installPeers?: boolean,
  saveDev?: boolean,
  packageManager?: 'npm' | 'yarn'
};

// TODO: should we allow other file systems? npm/yarn only work on node anyway...
const fs = new NodeFS();

async function install(
  modules: Array<string>,
  filepath: FilePath,
  options: InstallOptions = {}
): Promise<void> {
  let {
    installPeers = true,
    saveDev = true,
    packageManager: packageManagerName
  } = options;

  logger.progress(`Installing ${modules.join(', ')}...`);

  let packageLocation = await resolveConfig(fs, filepath, ['package.json']);
  let cwd = packageLocation ? path.dirname(packageLocation) : fs.cwd();

  if (!packageManagerName) {
    packageManagerName = await determinePackageManager(filepath);
  }

  let packageManager =
    packageManagerName === 'npm'
      ? new Npm({cwd, packageLocation})
      : new Yarn({cwd});

  try {
    await packageManager.install(modules, saveDev);
  } catch (err) {
    throw new Error(`Failed to install ${modules.join(', ')}.`);
  }

  if (installPeers) {
    await Promise.all(
      modules.map(m => installPeerDependencies(filepath, m, options))
    );
  }
}

async function installPeerDependencies(
  filepath: FilePath,
  name: string,
  options
) {
  let basedir = path.dirname(filepath);
  const [resolved] = await resolve(name, {basedir});
  const pkg = nullthrows(await loadConfig(fs, resolved, ['package.json']))
    .config;
  const peers = pkg.peerDependencies || {};

  const modules = [];
  for (const peer in peers) {
    modules.push(`${peer}@${peers[peer]}`);
  }

  if (modules.length) {
    await install(
      modules,
      filepath,
      Object.assign({}, options, {installPeers: false})
    );
  }
}

async function determinePackageManager(
  filepath: FilePath
): Promise<'npm' | 'yarn'> {
  let configFile = await resolveConfig(fs, filepath, [
    'yarn.lock',
    'package-lock.json'
  ]);
  let hasYarn = await Yarn.exists();

  // If Yarn isn't available, or there is a package-lock.json file, use npm.
  let configName = configFile && path.basename(configFile);
  if (!hasYarn || configName === 'package-lock.json') {
    return 'npm';
  }

  return 'yarn';
}

let queue = new PromiseQueue({maxConcurrent: 1});
let modulesInstalling: Set<string> = new Set();
// Exported so that it may be invoked from the worker api below.
// Do not call this directly! This can result in concurrent package installations
// across multiple instances of the package manager.
export function _addToInstallQueue(
  modules: Array<string>,
  filePath: FilePath,
  options?: InstallOptions
): Promise<mixed> {
  // Wrap PromiseQueue and track modules that are currently installing.
  // If a request comes in for a module that is currently installing, don't bother
  // enqueuing it.
  //
  // "module" means anything acceptable to yarn/npm. This can include a semver range,
  // e.g. "lodash@^3.2.0" -- we don't dedupe unless this entire string is an exact match.
  let modulesToInstall = modules.filter(m => !modulesInstalling.has(m));
  if (modulesToInstall.length) {
    for (let m of modulesToInstall) {
      modulesInstalling.add(m);
    }

    queue.add(() =>
      install(modulesToInstall, filePath, options).then(() => {
        for (let m of modulesToInstall) {
          modulesInstalling.delete(m);
        }
      })
    );
  }

  return queue.run();
}

export default function installPackage(
  ...args: [Array<string>, FilePath] | [Array<string>, FilePath, InstallOptions]
): Promise<mixed> {
  return WorkerFarm.callMaster({
    location: __filename,
    args,
    method: '_addToInstallQueue'
  });
}
