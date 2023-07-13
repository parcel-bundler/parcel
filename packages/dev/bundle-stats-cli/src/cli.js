/* eslint-disable no-console, monorepo/no-internal-import */
// @flow strict-local

import type {PackagedBundle} from '@parcel/types';
import type {ParcelOptions} from '@parcel/core/src/types';

// $FlowFixMe[untyped-import]
import {version} from '../package.json';

import commander from 'commander';
import fs from 'fs';
import path from 'path';

import {DefaultMap} from '@parcel/utils';

import {loadGraphs} from 'parcel-query/src/index.js';
import {getBundleStats} from '@parcel/reporter-bundle-stats/src/BundleStatsReporter';
import {PackagedBundle as PackagedBundleClass} from '@parcel/core/src/public/Bundle';
import type {commander$Command} from 'commander';

function run({cacheDir, outDir}) {
  // 1. load bundle graph and info via parcel~query
  let {bundleGraph, bundleInfo} = loadGraphs(cacheDir);

  if (bundleGraph == null) {
    console.error('Bundle Graph could not be found');
    process.exit(1);
    throw new Error();
  }

  if (bundleInfo == null) {
    console.error('Bundle Info could not be found');
    process.exit(1);
    throw new Error();
  }

  // 2. generate stats files for each target
  fs.mkdirSync(outDir, {recursive: true});

  let projectRoot = process.cwd();

  // $FlowFixMe[unclear-type]
  let parcelOptions: ParcelOptions = ({projectRoot}: any);

  let bundlesByTarget: DefaultMap<
    string /* target name */,
    Array<PackagedBundle>,
  > = new DefaultMap(() => []);
  for (let bundle of bundleGraph.getBundles()) {
    bundlesByTarget
      .get(bundle.target.name)
      .push(
        PackagedBundleClass.getWithInfo(
          bundle,
          bundleGraph,
          parcelOptions,
          bundleInfo.get(bundle.id),
        ),
      );
  }

  for (let [targetName, bundles] of bundlesByTarget) {
    fs.writeFileSync(
      path.join(outDir, `${targetName}-stats.json`),
      JSON.stringify(getBundleStats(bundles, parcelOptions), null, 2),
    );
  }
}

export const command: commander$Command = new commander.Command()
  .version(version, '-V, --version')
  .description('Generate a stats report for a Parcel build')
  .option('-v, --verbose', 'Print verbose output')
  .option(
    '-c, --cache-dir <path>',
    'Directory to the parcel cache',
    '.parcel-cache',
  )
  .option(
    '-o, --out-dir <path>',
    'Directory to write the stats to',
    'parcel-bundle-reports',
  )
  .action(run);
