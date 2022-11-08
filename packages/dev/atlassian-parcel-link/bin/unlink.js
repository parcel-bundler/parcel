#! /usr/bin/env node
// @flow strict-local
/* eslint-disable no-console */

// $FlowFixMe[untyped-import]
require('@parcel/babel-register');

const unlink = require('../src/unlink').default;

/*::
type ParsedArgs = {|
  dryRun: boolean,
  help: boolean,
|};
*/

const defaultArgs /*: ParsedArgs */ = {
  dryRun: false,
  help: false,
};

function printUsage(log = console.log) {
  log('Usage: atlassian-parcel-unlink [--dry]');
  log('Options:');
  log('  --dry        Do not write any changes');
  log('  --help       Print this message');
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
        throw new Error(`Unknown option: ${arg}`);
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
    unlink({
      appRoot: process.cwd(),
      // FIXME: Derive namespace from argv
      namespace: '@atlassian',
      // FIXME: Derive nodeModulesGlobs from argv
      nodeModulesGlobs: [
        'build-tools/*/node_modules',
        'build-tools/parcel/*/node_modules',
        'node_modules',
      ],
      dryRun: args.dryRun,
      log: console.log,
    });
    console.log('🎉 unlinking successful');
  } catch (e) {
    console.error(e.message);
    exitCode = 1;
  }
}

process.exit(exitCode);
