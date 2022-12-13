#! /usr/bin/env node
// @flow strict-local
/* eslint-disable no-console */

// $FlowFixMe[untyped-import]
require('@parcel/babel-register');

const path = require('path');

/*::
import typeof Commander from 'commander';
*/
// $FlowFixMe[incompatible-type]
// $FlowFixMe[prop-missing]
const commander /*: Commander */ = require('commander');

// $FlowFixMe[untyped-import]
const {version} = require('../package.json');
const {link} = require('../src/link');
const {unlink} = require('../src/unlink');
const {ParcelLinkConfig} = require('../src/ParcelLinkConfig');

const program = new commander.Command();

program
  .version(version, '-V, --version')
  .description('A tool for linking a dev copy of Parcel into an app')
  .addHelpText('after', `\nThe link command is the default command.`);

program
  .command('link [packageRoot]')
  .description('Link a dev copy of Parcel into an app', {
    packageRoot:
      'Path to the Parcel package root\nDefaults to the package root containing this package',
  })
  .option('-d, --dry-run', 'Do not write any changes')
  .option('-n, --namespace <namespace>', 'Namespace for packages', '@parcel')
  .option(
    '-g, --node-modules-globs <globs...>',
    'Locations where node_modules should be linked in the app',
    'node_modules',
  )
  .action((packageRoot, options) => {
    if (options.dryRun) console.log('Dry run...');
    let parcelLinkConfig = new ParcelLinkConfig({
      appRoot: process.cwd(),
      packageRoot: packageRoot ?? path.join(__dirname, '../../../'),
      namespace: options.namespace,
      nodeModulesGlobs: Array.isArray(options.nodeModulesGlobs)
        ? options.nodeModulesGlobs
        : [options.nodeModulesGlobs],
    });
    link(parcelLinkConfig, {dryRun: options.dryRun, log: console.log});
    console.log('🎉 Linking successful');
  });

program
  .command('unlink [packageRoot]')
  .description('Unlink a dev copy of Parcel into an app', {
    packageRoot:
      'Path to the Parcel package root\nDefaults to the package root containing this package',
  })
  .option('-d, --dry-run', 'Do not write any changes')
  .option('-f, --force-install', 'Force a reinstall after unlinking')
  .option(
    '-n, --namespace <namespace>',
    'Package namespace to restore',
    '@parcel',
  )
  .option(
    '-g, --node-modules-globs <globs...>',
    'Locations where node_modules should be unlinked in the app',
    'node_modules',
  )
  .action((packageRoot, options) => {
    if (options.dryRun) console.log('Dry run...');
    let parcelLinkConfig = new ParcelLinkConfig({
      appRoot: process.cwd(),
      packageRoot: packageRoot ?? path.join(__dirname, '../../../'),
      namespace: options.namespace,
      nodeModulesGlobs: Array.isArray(options.nodeModulesGlobs)
        ? options.nodeModulesGlobs
        : [options.nodeModulesGlobs],
    });

    unlink(parcelLinkConfig, {
      dryRun: options.dryRun,
      forceInstall: options.forceInstall,
      log: console.log,
    });
    console.log('🎉 Unlinking successful');
  });

program.parse();
