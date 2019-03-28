// @flow
import Config from './ParcelConfig';
import type {ParcelOptions, ReporterEvent} from '@parcel/types';
import logger from '@parcel/logger';
import bus from '@parcel/workers/src/bus';

import {CONFIG} from '@parcel/plugin';

type Opts = {|
  config: Config,
  options: ParcelOptions
|};

export default class ReporterRunner {
  config: Config;
  options: ParcelOptions;

  constructor(opts: Opts) {
    this.config = opts.config;
    this.options = opts.options;

    logger.onLog(event => this.report(event));
    bus.on('reporterEvent', event => this.report(event));
  }

  async report(event: ReporterEvent) {
    //let reporters = await this.config.getReporters();
    let plugin = require('@parcel/reporter-cli/src/SimpleCLIReporter');
    plugin = plugin.default ? plugin.default : plugin;
    plugin = plugin[CONFIG];
    let reporters = [plugin]; // TODO: get programmitically

    for (let reporter of reporters) {
      await reporter.report(event, this.options);
    }
  }
}

export function report(event: ReporterEvent) {
  bus.emit('reporterEvent', event);
}
