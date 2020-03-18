// @flow

import type {FilePath, PackageJSON} from '@parcel/types';
import type {ModuleRequest, PackageInstaller, InstallOptions} from './types';
import type {FileSystem} from '@parcel/fs';

import invariant from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import semver from 'semver';
import ThrowableDiagnostic, {
  generateJSONCodeHighlights,
  encodeJSONKeyComponent,
} from '@parcel/diagnostic';
import logger from '@parcel/logger';
import {loadConfig, PromiseQueue, resolveConfig, resolve} from '@parcel/utils';
import WorkerFarm from '@parcel/workers';

import {Npm} from './Npm';
import {Yarn} from './Yarn';
import {getConflictingLocalDependencies} from './utils';
import validateModuleSpecifier from './validateModuleSpecifier';

async function install(
  fs: FileSystem,
  modules: Array<ModuleRequest>,
  from: FilePath,
  options: InstallOptions = {},
): Promise<void> {
  let {installPeers = true, saveDev = true, packageInstaller} = options;
  let moduleNames = modules.map(m => m.name).join(', ');

  logger.progress(`Installing ${moduleNames}...`);

  let fromPkgPath = await resolveConfig(fs, from, ['package.json']);
  let cwd = fromPkgPath ? path.dirname(fromPkgPath) : fs.cwd();

  if (!packageInstaller) {
    packageInstaller = await determinePackageInstaller(fs, from);
  }

  try {
    await packageInstaller.install({
      modules,
      saveDev,
      cwd,
      packagePath: fromPkgPath,
      fs,
    });
  } catch (err) {
    throw new Error(`Failed to install ${moduleNames}.`);
  }

  if (installPeers) {
    await Promise.all(
      modules.map(m => installPeerDependencies(fs, m, from, options)),
    );
  }
}

async function installPeerDependencies(
  fs: FileSystem,
  module: ModuleRequest,
  from: FilePath,
  options,
) {
  let basedir = path.dirname(from);
  const {resolved} = await resolve(fs, module.name, {
    basedir,
    range: module.range,
  });
  const modulePkg: PackageJSON = nullthrows(
    await loadConfig(fs, resolved, ['package.json']),
  ).config;
  const peers = modulePkg.peerDependencies || {};

  let modules: Array<ModuleRequest> = [];
  for (let [name, range] of Object.entries(peers)) {
    invariant(typeof range === 'string');

    let conflicts = await getConflictingLocalDependencies(fs, name, from);
    if (conflicts) {
      let {pkg} = await resolve(fs, name, {
        basedir,
      });
      invariant(pkg);
      if (!semver.satisfies(pkg.version, range)) {
        throw new ThrowableDiagnostic({
          diagnostic: {
            message: `Could not install the peer dependency "${name}" for "${module.name}", installed version ${pkg.version} is incompatible with ${range}`,
            filePath: conflicts.filePath,
            origin: '@parcel/package-manager',
            language: 'json',
            codeFrame: {
              code: conflicts.json,
              codeHighlights: generateJSONCodeHighlights(
                conflicts.json,
                conflicts.fields.map(field => ({
                  key: `/${field}/${encodeJSONKeyComponent(name)}`,
                  type: 'key',
                  message: 'Found this conflicting local requirement.',
                })),
              ),
            },
          },
        });
      }

      continue;
    }
    modules.push({name, range});
  }

  if (modules.length) {
    await install(
      fs,
      modules,
      from,
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
