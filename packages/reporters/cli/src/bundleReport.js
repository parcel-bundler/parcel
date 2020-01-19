// @flow
import type {BundleGraph} from '@parcel/types';

import {generateBundleReport, prettifyTime} from '@parcel/utils';
import filesize from 'filesize';
import chalk from 'chalk';

import * as emoji from './emoji';
import {writeOut, table} from './render';
import {formatFilename} from './utils';

const LARGE_BUNDLE_SIZE = 1024 * 1024;
const COLUMNS = [
  {align: 'left'}, // name
  {align: 'right'}, // size
  {align: 'right'}, // time
];

export default function bundleReport(bundleGraph: BundleGraph) {
  // Get a list of bundles sorted by size
  let {bundles} = generateBundleReport(bundleGraph);
  let rows = [];

  for (let bundle of bundles) {
    // Add a row for the bundle
    rows.push([
      formatFilename(bundle.filePath || '', chalk.cyan.bold),
      chalk.bold(prettifySize(bundle.size, bundle.size > LARGE_BUNDLE_SIZE)),
      chalk.green.bold(prettifyTime(bundle.time)),
    ]);

    for (let asset of bundle.largestAssets) {
      // Add a row for the asset.
      rows.push([
        (asset == bundle.largestAssets[bundle.largestAssets.length - 1]
          ? '└── '
          : '├── ') + formatFilename(asset.filePath, chalk.reset),
        chalk.dim(prettifySize(asset.size)),
        chalk.dim(chalk.green(prettifyTime(asset.time))),
      ]);
    }

    if (bundle.totalAssets > bundle.largestAssets.length) {
      rows.push([
        '└── ' +
          chalk.dim(
            `+ ${bundle.totalAssets - bundle.largestAssets.length} more assets`,
          ),
      ]);
    }

    // If this isn't the last bundle, add an empty row before the next one
    if (bundle !== bundles[bundles.length - 1]) {
      rows.push([]);
    }
  }

  // Render table
  writeOut('');
  table(COLUMNS, rows);
}

function prettifySize(size, isLarge) {
  let res = filesize(size);
  if (isLarge) {
    return chalk.yellow(emoji.warning + '  ' + res);
  }
  return chalk.magenta(res);
}
