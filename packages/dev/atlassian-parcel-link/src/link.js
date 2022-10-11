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
  mapAtlassianPackageAliases,
  cleanupNodeModules,
  fsWrite,
  fsSymlink,
} from './util';

export type LinkOptions = {|
  appRoot: string,
  dryRun?: boolean,
  log?: (...data: mixed[]) => void,
|};

export default function link({
  appRoot,
  dryRun = false,
  log = () => {},
}: LinkOptions) {
  validateAppRoot(appRoot);

  let opts: CmdOptions = {appRoot, dryRun, log};

  let packageRoot = path.join(__dirname, '../../../../packages');
  validatePackageRoot(packageRoot);

  // Step 1: Determine all Parcel packages to link
  // --------------------------------------------------------------------------------

  let parcelPackages = findParcelPackages(packageRoot);
  let atlassianToParcelPackages = mapAtlassianPackageAliases(parcelPackages);

  // Step 2.1: In .parcelrc, rewrite all references to official plugins to `@parcel/*`
  // This is optional as the packages are also linked under the `@atlassian/parcel-*` name
  // --------------------------------------------------------------------------------

  log('Rewriting .parcelrc');
  let configPath = path.join(appRoot, '.parcelrc');
  let config = fs.readFileSync(configPath, 'utf8');
  fsWrite(
    configPath,
    config.replace(
      /"(@atlassian\/parcel-[^"]*)"/g,
      (_, match) => `"${atlassianToParcelPackages.get(match) ?? match}"`,
    ),
    opts,
  );

  // Step 2.2: In the root package.json, rewrite all references to official plugins to @parcel/...
  // For configs like "@atlassian/parcel-bundler-default":{"maxParallelRequests": 10}
  // --------------------------------------------------------------------------------

  log('Rewriting root package.json');
  let rootPkgPath = path.join(appRoot, 'package.json');
  let rootPkg: string = fs.readFileSync(rootPkgPath, 'utf8');
  for (let packageName of [
    '@atlassian/parcel-bundler-default',
    '@atlassian/parcel-bundler-experimental',
    '@atlassian/parcel-transformer-css',
  ]) {
    rootPkg = rootPkg.replace(
      new RegExp(packageName, 'g'),
      nullthrows(atlassianToParcelPackages.get(packageName)),
    );
  }

  fsWrite(rootPkgPath, rootPkg, opts);

  // Step 3: Delete all official packages (`@atlassian/parcel-*` or `@parcel/*`) from node_modules
  // --------------------------------------------------------------------------------

  const predicate = (packageName: string) =>
    parcelPackages.has(packageName) ||
    atlassianToParcelPackages.has(packageName);

  for (let nodeModules of [
    ...glob.sync('build-tools/*/node_modules', {cwd: appRoot}),
    ...glob.sync('build-tools/parcel/*/node_modules', {cwd: appRoot}),
    path.join(appRoot, 'node_modules'),
  ]) {
    cleanupNodeModules(nodeModules, predicate, opts);
  }

  // Step 4: Link the Parcel packages into node_modules as both `@parcel/*` and `@atlassian/parcel-*`
  // --------------------------------------------------------------------------------

  for (let [packageName, p] of parcelPackages) {
    fsSymlink(p, path.join(appRoot, 'node_modules', packageName), opts);
  }
  for (let [atlassianName, parcelName] of atlassianToParcelPackages) {
    let p = nullthrows(parcelPackages.get(parcelName));
    fsSymlink(p, path.join(appRoot, 'node_modules', atlassianName), opts);
  }

  // Step 5: Point `parcel` bin symlink to linked `packages/core/parcel/src/bin.js`
  // --------------------------------------------------------------------------------

  fsSymlink(
    path.join(packageRoot, 'core/parcel/src/bin.js'),
    path.join(appRoot, 'node_modules/.bin/parcel'),
    opts,
  );
}
