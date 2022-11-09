#! /usr/bin/env node
// @flow strict-local

import type {CmdOptions} from './util';

// $FlowFixMe[untyped-import]
import glob from 'glob';
import path from 'path';
import fs from 'fs';
import nullthrows from 'nullthrows';

import {
  cleanupNodeModules,
  execSync,
  findParcelPackages,
  fsWrite,
  mapNamespacePackageAliases,
  validateAppRoot,
  validatePackageRoot,
} from './util';

export type UnlinkOptions = {|
  appRoot: string,
  nodeModulesGlobs?: string[],
  namespace?: string,
  dryRun?: boolean,
  forceInstall?: boolean,
  log?: (...data: mixed[]) => void,
|};

export default function unlink({
  appRoot,
  namespace,
  // TODO: move this default up a level
  nodeModulesGlobs = ['node_modules'],
  dryRun = false,
  forceInstall = false,
  log = () => {},
}: UnlinkOptions) {
  validateAppRoot(appRoot);

  // FIXME: This should be detected from the links in the app.
  // Using this file's package root is techincally wrong
  // if the link was performed against a different package root.
  // We could add some config to the root package.json to store
  // the package root that was used to link.
  let packageRoot = path.join(__dirname, '../../../');
  validatePackageRoot(packageRoot);

  let nodeModulesPaths = nodeModulesGlobs.reduce(
    (matches, pattern) => [...matches, ...glob.sync(pattern, {cwd: appRoot})],
    [],
  );

  let opts: CmdOptions = {appRoot, packageRoot, dryRun, log};

  // Step 1: Determine all Parcel packages that could be linked
  // --------------------------------------------------------------------------------

  let parcelPackages = findParcelPackages(packageRoot);

  // Step 2: Delete all official packages (`@parcel/*`) from node_modules
  // This is very brute-force, but should ensure that we catch all linked packages.
  // --------------------------------------------------------------------------------

  for (let nodeModules of nodeModulesPaths) {
    cleanupNodeModules(
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
    let configPath = path.join(appRoot, '.parcelrc');
    let config = fs.readFileSync(configPath, 'utf8');
    for (let [alias, parcel] of namespacePackages) {
      config = config.replace(new RegExp(`"${parcel}"`, 'g'), `"${alias}"`);
    }
    fsWrite(configPath, config, opts);

    // Step 3.3: In the root package.json, restore all references to namespaced plugins
    // For configs like "@namespace/parcel-bundler-default":{"maxParallelRequests": 10}
    // --------------------------------------------------------------------------------

    log('Restoring root package.json');
    let rootPkgPath = path.join(appRoot, 'package.json');
    let rootPkg = fs.readFileSync(rootPkgPath, 'utf8');
    for (let [alias, parcel] of namespacePackages) {
      rootPkg = rootPkg.replace(
        new RegExp(`"${parcel}"(\\s*:\\s*{)`, 'g'),
        `"${alias}"$1`,
      );
    }
    fsWrite(rootPkgPath, rootPkg, opts);

    // Step 3.4: Delete all namespaced packages (`@namespace/parcel-*`) from node_modules
    // This is very brute-force, but should ensure that we catch all linked packages.
    // --------------------------------------------------------------------------------

    for (let nodeModules of nodeModulesPaths) {
      cleanupNodeModules(
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
