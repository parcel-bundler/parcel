// @flow strict-local
/* eslint-disable no-console, monorepo/no-internal-import */

import {GraphExplorer} from './GraphExplorer';
import {loadGraphs} from 'parcel-query';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import logger, {PluginLogger} from '@parcel/logger';

let cacheDir = path.join(process.cwd(), '.parcel-cache');
let canDev =
  process.env.PARCEL_BUILD_ENV !== 'production' ||
  process.env.PARCEL_SELF_BUILD != null;
let dev = false;
let verbose = false;

function showHelp() {
  console.log(`Usage: parcel-graph-explorer [options]

Options:
  --cache <filepath>  path to the parcel cache (default: .parcel_cache)
  --verbose           show verbose logs
  -h, --help          show help`);

  if (canDev) {
    console.log('  --dev               start the server in dev mode');
  }
  console.log('');
}

logger.onLog(event => {
  if (!event.diagnostics) return;
  for (let diagnostic of event.diagnostics) {
    switch (event.level) {
      case 'info':
        console.info(chalk.blue(diagnostic.message));
        break;
      case 'warn':
        console.warn(chalk.yellow(diagnostic.message));
        break;
      case 'error':
        console.error(chalk.red(diagnostic.message));
        break;
      case 'verbose':
        if (verbose) {
          console.debug(chalk.gray(diagnostic.message));
        }
        break;
      default:
        console.log(diagnostic.message);
        break;
    }
  }
});

let args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  showHelp();
  process.exit(0);
}

if (args.includes('--verbose')) {
  verbose = true;
  args = args.filter(arg => arg !== '--verbose');
}

while (args.length) {
  switch (args[0]) {
    case '--cache': {
      cacheDir = path.resolve(process.cwd(), args[1]);
      args = args.slice(2);
      break;
    }
    case '--dev': {
      if (!canDev) {
        logger.error('dev mode not supported');
        process.exit(1);
      }
      dev = true;
      args.pop();
      break;
    }
    default: {
      logger.error(`Unknown argument ${args[0]}`);
      showHelp();
      process.exit(1);
    }
  }
}

try {
  fs.accessSync(cacheDir);
} catch (e) {
  logger.error(`Can't find cache dir ${cacheDir}`);
  process.exit(1);
}

logger.info({message: 'Loading graphs...'});
let {assetGraph, bundleGraph, requestTracker, bundleInfo} =
  loadGraphs(cacheDir);

if (requestTracker == null) {
  console.error('Request Graph could not be found');
  process.exit(1);
  throw new Error();
}

if (bundleGraph == null) {
  console.error('Bundle Graph could not be found');
  process.exit(1);
  throw new Error();
}

if (assetGraph == null) {
  console.error('Asset Graph could not be found');
  process.exit(1);
  throw new Error();
}

if (bundleInfo == null) {
  console.error('Bundle Info could not be found');
  process.exit(1);
  throw new Error();
}

let explorer;

async function shutdown(cause) {
  if (cause instanceof Error) logger.error(cause);
  try {
    await explorer?.dispose();
  } catch (err) {
    logger.error(err);
  }
}

(async () => {
  try {
    explorer = new GraphExplorer(
      {assetGraph, bundleGraph, requestTracker, bundleInfo},
      new PluginLogger({origin: 'GraphExplorer'}),
      {verbose, dev},
    );
    await explorer.start();
  } catch (e) {
    logger.error(e);
    process.exit(1);
  }

  // TODO: Support restarting the server on file change in dev.

  process.on('uncaughtException', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGQUIT', shutdown);
  process.on('SIGTERM', shutdown);
})();
