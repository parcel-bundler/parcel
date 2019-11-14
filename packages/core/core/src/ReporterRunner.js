// @flow strict-local

import type {ReporterEvent} from '@parcel/types';
import type {ParcelOptions} from './types';

import {bundleToInternalBundle, NamedBundle} from './public/Bundle';
import {bus} from '@parcel/workers';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import ParcelConfig from './ParcelConfig';
import logger, {patchConsole, PluginLogger} from '@parcel/logger';
import PluginOptions from './public/PluginOptions';

type Opts = {|
  config: ParcelConfig,
  options: ParcelOptions
|};

export default class ReporterRunner {
  config: ParcelConfig;
  options: ParcelOptions;
  pluginOptions: PluginOptions;

  constructor(opts: Opts) {
    this.config = opts.config;
    this.options = opts.options;
    this.pluginOptions = new PluginOptions(this.options);

    logger.onLog(event => this.report(event));

    // Convert any internal bundles back to their public equivalents as reporting
    // is public api
    bus.on('reporterEvent', event => {
      if (event.bundle == null) {
        this.report(event);
      } else {
        this.report({
          ...event,
          bundle: new NamedBundle(event.bundle, event.bundleGraph, this.options)
        });
      }
    });

    if (this.options.patchConsole) {
      patchConsole();
    }
  }

  async report(event: ReporterEvent) {
    let reporters = await this.config.getReporters();

    for (let reporter of reporters) {
      try {
        await reporter.plugin.report({
          event,
          options: this.pluginOptions,
          logger: new PluginLogger({origin: reporter.name})
        });
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, reporter.name)
        });
      }
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
      bundle: bundleToInternalBundle(event.bundle)
    });
  }
}
