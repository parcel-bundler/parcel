// @flow

import type {FilePath} from '@parcel/types';
import type {PackageInstaller, InstallOptions} from './types';
import type {FileSystem} from '@parcel/fs';

import logger from '@parcel/logger';
import path from 'path';
import nullthrows from 'nullthrows';
import WorkerFarm from '@parcel/workers';

import {loadConfig, PromiseQueue, resolveConfig, resolve} from '@parcel/utils';
import {Npm} from './Npm';
import {Yarn} from './Yarn';
import validateModuleSpecifiers from './validateModuleSpecifiers';

async function install(
  fs: FileSystem,
  modules: Array<string>,
  filepath: FilePath,
  options: InstallOptions = {}
): Promise<void> {
  let {installPeers = true, saveDev = true, packageInstaller} = options;

  logger.progress(`Installing ${modules.join(', ')}...`);

  let packagePath = await resolveConfig(fs, filepath, ['package.json']);
  let cwd = packagePath ? path.dirname(packagePath) : fs.cwd();

  if (!packageInstaller) {
    packageInstaller = await determinePackageInstaller(fs, filepath);
  }

  try {
    await packageInstaller.install({modules, saveDev, cwd, packagePath, fs});
  } catch (err) {
    throw new Error(`Failed to install ${modules.join(', ')}.`);
  }

  if (installPeers) {
    await Promise.all(
      modules.map(m => installPeerDependencies(fs, filepath, m, options))
    );
  }
}

async function installPeerDependencies(
  fs: FileSystem,
  filepath: FilePath,
  name: string,
  options
) {
  let basedir = path.dirname(filepath);
  const {resolved} = await resolve(fs, name, {basedir});
  const pkg = nullthrows(await loadConfig(fs, resolved, ['package.json']))
    .config;
  const peers = pkg.peerDependencies || {};

  const modules = [];
  for (const peer in peers) {
    modules.push(`${peer}@${peers[peer]}`);
  }

  if (modules.length) {
    await install(
      fs,
      modules,
      filepath,
      Object.assign({}, options, {installPeers: false})
    );
  }
}

async function determinePackageInstaller(
  fs: FileSystem,
  filepath: FilePath
): Promise<PackageInstaller> {
  let configFile = await resolveConfig(fs, filepath, [
    'yarn.lock',
    'package-lock.json'
  ]);
  let hasYarn = await Yarn.exists();

  // If Yarn isn't available, or there is a package-lock.json file, use npm.
  let configName = configFile && path.basename(configFile);
  if (!hasYarn || configName === 'package-lock.json') {
    return new Npm();
  }

  return new Yarn();
}

let queue = new PromiseQueue({maxConcurrent: 1});
let modulesInstalling: Set<string> = new Set();

// Exported so that it may be invoked from the worker api below.
// Do not call this directly! This can result in concurrent package installations
// across multiple instances of the package manager.
export function _addToInstallQueue(
  fs: FileSystem,
  modules: Array<string>,
  filePath: FilePath,
  options?: InstallOptions
): Promise<mixed> {
  modules = validateModuleSpecifiers(modules);

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

    queue
      .add(() =>
        install(fs, modulesToInstall, filePath, options).then(() => {
          for (let m of modulesToInstall) {
            modulesInstalling.delete(m);
          }
        })
      )
      .then(() => {}, () => {});
  }

  return queue.run();
}

export function installPackage(
  fs: FileSystem,
  modules: Array<string>,
  filePath: FilePath,
  options?: InstallOptions
): Promise<mixed> {
  if (WorkerFarm.isWorker()) {
    let workerApi = WorkerFarm.getWorkerApi();
    return workerApi.callMaster({
      location: __filename,
      args: [fs, modules, filePath, options],
      method: '_addToInstallQueue'
    });
  }

  return _addToInstallQueue(fs, modules, filePath, options);
}
