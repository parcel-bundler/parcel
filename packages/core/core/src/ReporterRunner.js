// @flow strict-local

import type {ReporterEvent} from '@parcel/types';
import type {ParcelOptions} from './types';
import type WorkerFarm from '@parcel/workers';

import {bundleToInternalBundle, NamedBundle} from './public/Bundle';
import {bus} from '@parcel/workers';
import ParcelConfig from './ParcelConfig';
import logger, {patchConsole} from '@parcel/logger';

type Opts = {|
  config: ParcelConfig,
  options: ParcelOptions,
  farm: WorkerFarm,
|};

export default class ReporterRunner {
  config: ParcelConfig;
  options: ParcelOptions;
  reportHandle: ({|
    config: ParcelConfig,
    opts: ParcelOptions,
    event: ReporterEvent,
  |}) => Promise<void>;

  constructor(opts: Opts) {
    this.config = opts.config;
    this.options = opts.options;
    this.reportHandle = opts.farm.createHandle('runReport', 'reporter-queue');

    logger.onLog(event => this.report(event));

    // Convert any internal bundles back to their public equivalents as reporting
    // is public api
    bus.on('reporterEvent', event => {
      if (event.bundle == null) {
        this.report(event);
      } else {
        this.report({
          ...event,
          bundle: new NamedBundle(
            event.bundle,
            event.bundleGraph,
            this.options,
          ),
        });
      }
    });

    if (this.options.patchConsole) {
      patchConsole();
    }
  }

  report(event: ReporterEvent) {
    return this.reportHandle({
      config: this.config,
      opts: this.options,
      event,
    });
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
      bundle: bundleToInternalBundle(event.bundle),
    });
  }
}
