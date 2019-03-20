// @flow strict-local

import type {ParcelOptions, ReporterEvent} from '@parcel/types';

import {bundleToInternal, NamedBundle} from './public/Bundle';
import bus from '@parcel/workers/src/bus';
import Config from './ParcelConfig';
import logger from '@parcel/logger';
import nullthrows from 'nullthrows';

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

    // Convert any internal bundles back to their public equivalents as reporting
    // is public api
    bus.on('reporterEvent', event => {
      if (event.bundle == null) {
        this.report(event);
      } else {
        this.report({
          ...event,
          bundle: new NamedBundle(event.bundle)
        });
      }
    });
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
  if (event.bundle == null) {
    bus.emit('reporterEvent', event);
  } else {
    // Convert any public api bundles to their internal equivalents for
    // easy serialization
    bus.emit('reporterEvent', {
      ...event,
      bundle: nullthrows(bundleToInternal.get(event.bundle))
    });
  }
}
