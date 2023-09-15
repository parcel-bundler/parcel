/* eslint-disable monorepo/no-internal-import */
// @flow strict-local

import type {PackagedBundle, PluginLogger} from '@parcel/types';
import type {ParcelOptions} from '@parcel/core/src/types';
import type {commander$Command} from 'commander';

// $FlowFixMe[untyped-import]
import {version} from '../package.json';

import commander from 'commander';
import path from 'path';

import {DefaultMap} from '@parcel/utils';

import {loadGraphs} from 'parcel-query/src/index.js';
import {getBundleStats} from '@parcel/reporter-bundle-stats/src/BundleStatsReporter';
import {PackagedBundle as PackagedBundleClass} from '@parcel/core/src/public/Bundle';
import {NodeFS} from '@parcel/fs';

interface Message {
  message: string;
}

type Loggable = string | Message | Array<Message>;

class Logger implements PluginLogger {
  #verbose: boolean;
  #out: typeof console;
  constructor(verbose: boolean, out = console) {
    this.#verbose = verbose;
    this.#out = out;
  }
  static #messageToString(msg: Loggable): string {
    if (typeof msg === 'string') return msg;
    if (Array.isArray(msg)) return msg.map(m => m.message).join('\n');
    return msg.message;
  }
  static #messagesToStrings(msg: Array<Loggable>): Array<string> {
    return msg.map(m => Logger.#messageToString(m));
  }
  // $FlowFixMe[incompatible-type]
  verbose(...msg: Array<Loggable>) {
    if (this.#verbose) {
      this.#out.debug(...Logger.#messagesToStrings(msg));
    }
  }
  debug(...msg: Array<Loggable>) {
    this.verbose(...msg);
  }
  // $FlowFixMe[incompatible-type]
  info(...msg: Array<Loggable>) {
    this.#out.info(...Logger.#messagesToStrings(msg));
  }
  // $FlowFixMe[incompatible-type]
  log(...msg: Array<Loggable>) {
    this.#out.log(...Logger.#messagesToStrings(msg));
  }
  // $FlowFixMe[incompatible-type]
  warn(...msg: Array<Loggable>) {
    this.#out.warn(...Logger.#messagesToStrings(msg));
  }
  // $FlowFixMe[incompatible-type]
  error(...msg: Array<Loggable>) {
    this.#out.error(...Logger.#messagesToStrings(msg));
  }
}

async function run({cacheDir, outDir, verbose}) {
  let logger = new Logger(verbose);
  let fs = new NodeFS();

  logger.info('loading graphs from', cacheDir);

  // 1. load bundle graph and info via parcel~query
  let {bundleGraph, bundleInfo} = loadGraphs(cacheDir);

  if (bundleGraph == null) {
    logger.error('Bundle Graph could not be found');
    process.exit(1);
    throw new Error();
  }

  if (bundleInfo == null) {
    logger.error('Bundle Info could not be found');
    process.exit(1);
    throw new Error();
  }

  // 2. generate stats files for each target
  await fs.mkdirp(outDir);

  let projectRoot = process.cwd();

  let parcelOptions: ParcelOptions = ({
    projectRoot,
    inputFS: fs,
    outputFS: fs,
    // $FlowFixMe[unclear-type]
  }: any);

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
    {
      logger.info(
        `generating stats for ${bundles.length} and with ${targetName} target`,
      );
      let filename = path.join(outDir, `${targetName}-stats.json`);
      await fs.writeFile(
        filename,
        JSON.stringify(getBundleStats(bundles, parcelOptions), null, 2),
      );
      logger.info(`Wrote ${filename}`);
    }
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
