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
  mapAtlassianPackageAliases,
  validateAppRoot,
  validatePackageRoot,
} from './util';

export type UnlinkOptions = {|
  appRoot: string,
  dryRun?: boolean,
  log?: (...data: mixed[]) => void,
|};

export default function unlink({
  appRoot,
  dryRun = false,
  log = () => {},
}: UnlinkOptions) {
  validateAppRoot(appRoot);

  // FIXME: This should be detected from the links in the app.
  // Using this file's package root is techincally wrong
  // if the link was performed against a different package root.
  let packageRoot = path.join(__dirname, '../../../');
  validatePackageRoot(packageRoot);

  let opts: CmdOptions = {appRoot, packageRoot, dryRun, log};

  // Step 1: Determine all Parcel packages that could be linked
  // --------------------------------------------------------------------------------

  let parcelPackages = findParcelPackages(packageRoot);
  let atlassianToParcelPackages = mapAtlassianPackageAliases(parcelPackages);

  // Step 2.1: In .parcelrc, restore all references to atlassian plugins.
  // --------------------------------------------------------------------------------

  log('Restoring .parcelrc');
  let configPath = path.join(appRoot, '.parcelrc');
  let config = fs.readFileSync(configPath, 'utf8');

  for (let [atlassian, parcel] of atlassianToParcelPackages) {
    config = config.replace(new RegExp(`"${parcel}"`, 'g'), `"${atlassian}"`);
  }

  fsWrite(configPath, config, opts);

  // Step 2.2: In the root package.json, restore all references to atlassian plugins
  // For configs like "@atlassian/parcel-bundler-default":{"maxParallelRequests": 10}
  // --------------------------------------------------------------------------------

  log('Restoring root package.json');
  let rootPkgPath = path.join(appRoot, 'package.json');
  let rootPkg: string = fs.readFileSync(rootPkgPath, 'utf8');
  for (let packageName of [
    '@atlassian/parcel-bundler-default',
    '@atlassian/parcel-bundler-experimental',
    '@atlassian/parcel-transformer-css',
  ]) {
    rootPkg = rootPkg.replace(
      new RegExp(nullthrows(atlassianToParcelPackages.get(packageName)), 'g'),
      packageName,
    );
  }

  fsWrite(rootPkgPath, rootPkg, opts);

  // Step 3: Delete all official packages (`@atlassian/parcel-*` or `@parcel/*`) from node_modules
  // This is very brute-force, but should ensure that we catch all linked packages.
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

  // Step 6: Run `yarn` to restore all dependencies.
  // --------------------------------------------------------------------------------

  log('Running `yarn` to restore dependencies');
  execSync('yarn', opts);
}
