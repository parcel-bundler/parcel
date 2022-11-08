#! /usr/bin/env node
// @flow strict-local

import type {CmdOptions} from './util';

// $FlowFixMe[untyped-import]
import glob from 'glob';
import path from 'path';
import fs from 'fs';
import nullthrows from 'nullthrows';

import {
  validateAppRoot,
  validatePackageRoot,
  findParcelPackages,
  mapNamespacePackageAliases,
  cleanupNodeModules,
  fsWrite,
  fsSymlink,
} from './util';

export type LinkOptions = {|
  appRoot: string,
  packageRoot: string,
  nodeModulesGlobs?: string[],
  namespace?: string,
  dryRun?: boolean,
  log?: (...data: mixed[]) => void,
|};

export default function link({
  appRoot,
  packageRoot,
  namespace,
  dryRun = false,
  nodeModulesGlobs = ['node_modules'],
  log = () => {},
}: LinkOptions) {
  validateAppRoot(appRoot);

  let nodeModulesPaths = nodeModulesGlobs.reduce(
    (matches, pattern) => [...matches, ...glob.sync(pattern, {cwd: appRoot})],
    [],
  );

  let opts: CmdOptions = {appRoot, packageRoot, dryRun, log};

  validatePackageRoot(packageRoot);

  // Step 1: Determine all Parcel packages to link
  // --------------------------------------------------------------------------------

  let parcelPackages = findParcelPackages(packageRoot);

  // Step 2: Delete all official packages (`@parcel/*`) from node_modules
  // --------------------------------------------------------------------------------

  for (let nodeModules of nodeModulesPaths) {
    cleanupNodeModules(
      nodeModules,
      packageName => parcelPackages.has(packageName),
      opts,
    );
  }

  // Step 3: Link the Parcel packages into node_modules
  // --------------------------------------------------------------------------------

  for (let [packageName, p] of parcelPackages) {
    fsSymlink(p, path.join(appRoot, 'node_modules', packageName), opts);
  }

  // Step 4: Point `parcel` bin symlink to linked `packages/core/parcel/src/bin.js`
  // --------------------------------------------------------------------------------

  fsSymlink(
    path.join(packageRoot, 'core/parcel/src/bin.js'),
    path.join(appRoot, 'node_modules/.bin/parcel'),
    opts,
  );

  // Step 5 (optional): If a namespace is defined, map namespaced package aliases.
  // --------------------------------------------------------------------------------

  if (namespace != null) {
    let namespacePackages = mapNamespacePackageAliases(
      namespace,
      parcelPackages,
    );

    // Step 5.1: In .parcelrc, rewrite all references to official plugins to `@parcel/*`
    // This is optional as the packages are also linked under the `@atlassian/parcel-*` name
    // --------------------------------------------------------------------------------

    log('Rewriting .parcelrc');
    let configPath = path.join(appRoot, '.parcelrc');
    let config = fs.readFileSync(configPath, 'utf8');
    fsWrite(
      configPath,
      config.replace(
        new RegExp(`"(${namespace}/parcel-[^"]*)"`, 'g'),
        (_, match) => `"${namespacePackages.get(match) ?? match}"`,
      ),
      opts,
    );

    // Step 5.2: In the root package.json, rewrite all references to official plugins to @parcel/...
    // For configs like "@namespace/parcel-bundler-default":{"maxParallelRequests": 10}
    // --------------------------------------------------------------------------------

    log('Rewriting root package.json');
    let rootPkgPath = path.join(appRoot, 'package.json');
    let rootPkg: string = fs.readFileSync(rootPkgPath, 'utf8');
    for (let packageName of [
      `${namespace}/parcel-bundler-default`,
      `${namespace}/parcel-bundler-experimental`,
      `${namespace}/parcel-transformer-css`,
    ]) {
      rootPkg = rootPkg.replace(
        new RegExp(packageName, 'g'),
        nullthrows(namespacePackages.get(packageName)),
      );
    }

    fsWrite(rootPkgPath, rootPkg, opts);

    // Step 5.3: Delete namespaced packages (`@namespace/parcel-*`) from node_modules
    // --------------------------------------------------------------------------------

    for (let nodeModules of nodeModulesPaths) {
      cleanupNodeModules(
        nodeModules,
        packageName => namespacePackages.has(packageName),
        opts,
      );
    }

    // Step 5.4: Link the Parcel packages into node_modules as `@namespace/parcel-*`
    // --------------------------------------------------------------------------------

    for (let [alias, parcelName] of namespacePackages) {
      let p = nullthrows(parcelPackages.get(parcelName));
      fsSymlink(p, path.join(appRoot, 'node_modules', alias), opts);
    }
  }
}
