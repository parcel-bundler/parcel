#! /usr/bin/env node
// @flow strict-local
/* eslint-disable no-console */

// $FlowFixMe[untyped-import]
require('@parcel/babel-register');

/*::
import typeof Commander from 'commander';
*/
// $FlowFixMe[incompatible-type]
// $FlowFixMe[prop-missing]
const commander /*: Commander */ = require('commander');

// $FlowFixMe[untyped-import]
const {version} = require('../package.json');
const unlink = require('../src/unlink').default;

const program = new commander.Command();

program
  .version(version, '-V, --version')
  .description('Unlink a dev copy of Parcel from an app')
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
    value => (Array.isArray(value) ? value : [value]),
    'node_modules',
  )
  .action((packageRoot, options) => {
    if (options.dryRun) console.log('Dry run...');
    unlink({
      appRoot: process.cwd(),
      namespace: options.namespace,
      nodeModulesGlobs: options.nodeModulesGlobs,
      dryRun: options.dryRun,
      forceInstall: options.forceInstall,
      log: console.log,
    });
    console.log('🎉 Unlinking successful');
  })
  .parse();
