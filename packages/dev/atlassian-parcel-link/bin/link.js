#! /usr/bin/env node
// @flow strict-local
/* eslint-disable no-console */

// $FlowFixMe[untyped-import]
require('@parcel/babel-register');

const path = require('path');

const link = require('../src/link').default;

/*::
type ParsedArgs = {|
  dryRun: boolean,
  help: boolean,
  packageRoot?: string,
|};
*/

const defaultArgs /*: ParsedArgs */ = {
  dryRun: false,
  help: false,
};

function printUsage(log = console.log) {
  log('Usage: atlassian-parcel-link [--dry] [packageRoot]');
  log('Options:');
  log('  --dry        Do not write any changes');
  log('  --help       Print this message');
  log('Arguments:');
  log('  packageRoot  Path to the Parcel package root');
  log('               Defaults to the package root containing this package');
}

function parseArgs(args) {
  const parsedArgs = {...defaultArgs};
  for (let arg of args) {
    switch (arg) {
      case '--dry':
        parsedArgs.dryRun = true;
        break;
      case '--help':
        parsedArgs.help = true;
        break;
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        parsedArgs.packageRoot = arg;
    }
  }
  return parsedArgs;
}

let exitCode = 0;

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(e.message);
  printUsage(console.error);
  exitCode = 1;
}

if (args?.help) {
  printUsage();
  exitCode = 0;
} else if (args) {
  try {
    if (args.dryRun) console.log('Dry run...');
    link({
      appRoot: process.cwd(),
      packageRoot: args.packageRoot ?? path.join(__dirname, '../../../'),
      dryRun: args.dryRun,
      log: console.log,
    });
    console.log('🎉 Linking successful');
  } catch (e) {
    console.error(e.message);
    exitCode = 1;
  }
}

process.exit(exitCode);
