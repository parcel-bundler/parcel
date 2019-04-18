// @flow
import Config from './Config';
import type {ParcelOptions, ReporterEvent, Target} from '@parcel/types';
import logger from '@parcel/logger';
import bus from '@parcel/workers/src/bus';

type Opts = {|
  config: Config,
  options: ParcelOptions,
  targets: Array<Target>
|};

export default class ReporterRunner {
  config: Config;
  options: ParcelOptions;
  targets: Array<Target>;

  constructor(opts: Opts) {
    this.config = opts.config;
    this.options = opts.options;
    this.targets = opts.targets;

    logger.onLog(event => this.report(event));
    bus.on('reporterEvent', event => this.report(event));
  }

  async report(event: ReporterEvent) {
    let reporters = await this.config.getReporters();

    for (let reporter of reporters) {
      await reporter.report(event, this.options, this.targets);
    }
  }
}

export function report(event: ReporterEvent) {
  bus.emit('reporterEvent', event);
}
