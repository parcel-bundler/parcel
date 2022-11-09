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
const link = require('../src/link').default;

const program = new commander.Command();

program
  .arguments('[packageRoot]')
  .version(version, '-V, --version')
  .description('Link a dev copy of Parcel into an app', {
    packageRoot:
      'Path to the Parcel package root\nDefaults to the package root containing this package',
  })
  .option('-d, --dry-run', 'Do not write any changes')
  .option('-n, --namespace <namespace>', 'Namespace for packages', '@parcel')
  .option(
    '-g, --node-modules-globs <globs...>',
    'Locations where node_modules should be linked in the app',
    value => (Array.isArray(value) ? value : [value]),
    'node_modules',
  )
  .action((packageRoot, options) => {
    if (options.dryRun) console.log('Dry run...');
    link({
      appRoot: process.cwd(),
      packageRoot: packageRoot ?? path.join(__dirname, '../../../'),
      namespace: options.namespace,
      nodeModulesGlobs: options.nodeModulesGlobs,
      dryRun: options.dryRun,
      log: console.log,
    });
    console.log('🎉 Linking successful');
  })
  .parse();
