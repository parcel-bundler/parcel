// @flow
import Config from './Config';
import {ParcelOptions, ReporterEvent} from '@parcel/types';
import logger from '@parcel/logger';

type Opts = {
  config: Config,
  options: ParcelOptions
};

export default class ReporterRunner {
  config: Config;
  options: ParcelOptions;

  constructor(opts: Opts) {
    this.config = opts.config;
    this.options = opts.options;

    logger.on('log', event => this.report(event));
  }

  async report(event: ReporterEvent) {
    let reporters = await this.config.getReporters();

    for (let reporter of reporters) {
      await reporter.report(event, this.options);
    }
  }
}
