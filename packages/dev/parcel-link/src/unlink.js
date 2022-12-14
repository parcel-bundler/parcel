// @flow strict-local

import type {ParcelLinkConfig} from './ParcelLinkConfig';
import type {CmdOptions} from './util';

import {
  cleanupNodeModules,
  execSync,
  findParcelPackages,
  fsWrite,
  mapNamespacePackageAliases,
} from './util';

// $FlowFixMe[untyped-import]
import glob from 'glob';
import path from 'path';

export type UnlinkOptions = {|
  dryRun?: boolean,
  forceInstall?: boolean,
  log?: (...data: mixed[]) => void,
|};

export async function unlink(
  config: ParcelLinkConfig,
  {dryRun = false, forceInstall = false, log = () => {}}: UnlinkOptions,
) {
  config.validate();

  let {appRoot, packageRoot, namespace, nodeModulesGlobs} = config;

  let nodeModulesPaths = config.getNodeModulesPaths();

  let opts: CmdOptions = {appRoot, packageRoot, dryRun, log, fs: config.fs};

  // Step 1: Determine all Parcel packages that could be linked
  // --------------------------------------------------------------------------------

  let parcelPackages = await findParcelPackages(config.fs, packageRoot);

  // Step 2: Delete all official packages (`@parcel/*`) from node_modules
  // This is very brute-force, but should ensure that we catch all linked packages.
  // --------------------------------------------------------------------------------

  for (let nodeModules of nodeModulesPaths) {
    await cleanupNodeModules(
      nodeModules,
      packageName => parcelPackages.has(packageName),
      opts,
    );
  }

  // Step 3 (optional): If a namespace is not "@parcel", restore all aliased references.
  // --------------------------------------------------------------------------------

  if (namespace != null && namespace !== '@parcel') {
    // Step 3.1: Determine all namespace packages that could be aliased
    // --------------------------------------------------------------------------------

    let namespacePackages = mapNamespacePackageAliases(
      namespace,
      parcelPackages,
    );

    // Step 3.2: In .parcelrc, restore all references to namespaced plugins.
    // --------------------------------------------------------------------------------

    log('Restoring .parcelrc');
    let parcelConfigPath = path.join(appRoot, '.parcelrc');
    let parcelConfig = config.fs.readFileSync(parcelConfigPath, 'utf8');
    for (let [alias, parcel] of namespacePackages) {
      parcelConfig = parcelConfig.replace(
        new RegExp(`"${parcel}"`, 'g'),
        `"${alias}"`,
      );
    }
    await fsWrite(parcelConfigPath, parcelConfig, opts);

    // Step 3.3: In the root package.json, restore all references to namespaced plugins
    // For configs like "@namespace/parcel-bundler-default":{"maxParallelRequests": 10}
    // --------------------------------------------------------------------------------

    log('Restoring root package.json');
    let rootPkgPath = path.join(appRoot, 'package.json');
    let rootPkg = config.fs.readFileSync(rootPkgPath, 'utf8');
    for (let [alias, parcel] of namespacePackages) {
      rootPkg = rootPkg.replace(
        new RegExp(`"${parcel}"(\\s*:\\s*{)`, 'g'),
        `"${alias}"$1`,
      );
    }
    await fsWrite(rootPkgPath, rootPkg, opts);

    // Step 3.4: Delete all namespaced packages (`@namespace/parcel-*`) from node_modules
    // This is very brute-force, but should ensure that we catch all linked packages.
    // --------------------------------------------------------------------------------

    for (let nodeModules of nodeModulesPaths) {
      await cleanupNodeModules(
        nodeModules,
        packageName => namespacePackages.has(packageName),
        opts,
      );
    }
  }

  // Step 4 (optional): Run `yarn` to restore all dependencies.
  // --------------------------------------------------------------------------------

  if (forceInstall) {
    // FIXME: This should detect the package manager in use.
    log('Running `yarn` to restore dependencies');
    execSync('yarn install --force', opts);
  } else {
    log('Run `yarn install --force` (or similar) to restore dependencies');
  }
}
