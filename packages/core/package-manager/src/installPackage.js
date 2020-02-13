// @flow

import type {FilePath} from '@parcel/types';
import type {ModuleRequest, PackageInstaller, InstallOptions} from './types';
import type {FileSystem} from '@parcel/fs';

import invariant from 'assert';
import logger from '@parcel/logger';
import path from 'path';
import nullthrows from 'nullthrows';
import WorkerFarm from '@parcel/workers';

import {loadConfig, PromiseQueue, resolveConfig, resolve} from '@parcel/utils';
import {Npm} from './Npm';
import {Yarn} from './Yarn';
import validateModuleSpecifier from './validateModuleSpecifier';

async function install(
  fs: FileSystem,
  modules: Array<ModuleRequest>,
  filepath: FilePath,
  options: InstallOptions = {},
): Promise<void> {
  let {installPeers = true, saveDev = true, packageInstaller} = options;
  let moduleNames = modules.map(m => m.name).join(', ');

  logger.progress(`Installing ${moduleNames}...`);

  let packagePath = await resolveConfig(fs, filepath, ['package.json']);
  let cwd = packagePath ? path.dirname(packagePath) : fs.cwd();

  if (!packageInstaller) {
    packageInstaller = await determinePackageInstaller(fs, filepath);
  }

  try {
    await packageInstaller.install({modules, saveDev, cwd, packagePath, fs});
  } catch (err) {
    throw new Error(`Failed to install ${moduleNames}.`);
  }

  if (installPeers) {
    await Promise.all(
      modules.map(m => installPeerDependencies(fs, filepath, m, options)),
    );
  }
}

async function installPeerDependencies(
  fs: FileSystem,
  filepath: FilePath,
  module: ModuleRequest,
  options,
) {
  let basedir = path.dirname(filepath);
  const {resolved} = await resolve(fs, module.name, {
    basedir,
    range: module.range,
  });
  const pkg = nullthrows(await loadConfig(fs, resolved, ['package.json']))
    .config;
  const peers = pkg.peerDependencies || {};

  const modules = Object.entries(peers).map(([name, range]) => {
    invariant(typeof range === 'string');
    return {
      name,
      range,
    };
  });

  if (modules.length) {
    await install(
      fs,
      modules,
      filepath,
      Object.assign({}, options, {installPeers: false}),
    );
  }
}

async function determinePackageInstaller(
  fs: FileSystem,
  filepath: FilePath,
): Promise<PackageInstaller> {
  let configFile = await resolveConfig(fs, filepath, [
    'yarn.lock',
    'package-lock.json',
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
  modules: Array<ModuleRequest>,
  filePath: FilePath,
  options?: InstallOptions,
): Promise<mixed> {
  modules = modules.map(request => ({
    name: validateModuleSpecifier(request.name),
    range: request.range,
  }));

  // Wrap PromiseQueue and track modules that are currently installing.
  // If a request comes in for a module that is currently installing, don't bother
  // enqueuing it.
  let modulesToInstall = modules.filter(
    m => !modulesInstalling.has(getModuleRequestKey(m)),
  );
  if (modulesToInstall.length) {
    for (let m of modulesToInstall) {
      modulesInstalling.add(getModuleRequestKey(m));
    }

    queue
      .add(() =>
        install(fs, modulesToInstall, filePath, options).then(() => {
          for (let m of modulesToInstall) {
            modulesInstalling.delete(getModuleRequestKey(m));
          }
        }),
      )
      .then(
        () => {},
        () => {},
      );
  }

  return queue.run();
}

export function installPackage(
  fs: FileSystem,
  modules: Array<ModuleRequest>,
  filePath: FilePath,
  options?: InstallOptions,
): Promise<mixed> {
  if (WorkerFarm.isWorker()) {
    let workerApi = WorkerFarm.getWorkerApi();
    return workerApi.callMaster({
      location: __filename,
      args: [fs, modules, filePath, options],
      method: '_addToInstallQueue',
    });
  }

  return _addToInstallQueue(fs, modules, filePath, options);
}

function getModuleRequestKey(moduleRequest: ModuleRequest): string {
  return [moduleRequest.name, moduleRequest.range].join('@');
}
