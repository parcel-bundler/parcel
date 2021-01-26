// @flow strict-local

import type {ReporterEvent} from '@parcel/types';
import type {WorkerApi} from '@parcel/workers';
import type {Bundle as InternalBundle, ParcelOptions} from './types';

import invariant from 'assert';
import {
  bundleToInternalBundle,
  bundleToInternalBundleGraph,
  NamedBundle,
} from './public/Bundle';
import WorkerFarm, {bus} from '@parcel/workers';
import ParcelConfig from './ParcelConfig';
import logger, {
  patchConsole,
  unpatchConsole,
  PluginLogger,
  INTERNAL_ORIGINAL_CONSOLE,
} from '@parcel/logger';
import PluginOptions from './public/PluginOptions';
import BundleGraph from './BundleGraph';

type Opts = {|
  config: ParcelConfig,
  options: ParcelOptions,
  workerFarm: WorkerFarm,
|};

export default class ReporterRunner {
  workerFarm: WorkerFarm;
  config: ParcelConfig;
  options: ParcelOptions;
  pluginOptions: PluginOptions;

  constructor(opts: Opts) {
    this.config = opts.config;
    this.options = opts.options;
    this.workerFarm = opts.workerFarm;
    this.pluginOptions = new PluginOptions(this.options);

    logger.onLog(event => this.report(event));

    bus.on('reporterEvent', this.eventHandler);

    if (this.options.shouldPatchConsole) {
      patchConsole();
    } else {
      unpatchConsole();
    }
  }

  eventHandler: ReporterEvent => void = (event): void => {
    if (
      event.type === 'buildProgress' &&
      (event.phase === 'optimizing' || event.phase === 'packaging') &&
      !(event.bundle instanceof NamedBundle)
    ) {
      // $FlowFixMe[prop-missing]
      let bundleGraphRef = event.bundleGraphRef;
      // $FlowFixMe[incompatible-exact]
      let bundle: InternalBundle = event.bundle;
      // Convert any internal bundles back to their public equivalents as reporting
      // is public api
      let bundleGraph = this.workerFarm.workerApi.getSharedReference(
        // $FlowFixMe
        bundleGraphRef,
      );
      invariant(bundleGraph instanceof BundleGraph);
      // $FlowFixMe[incompatible-call]
      this.report({
        ...event,
        bundle: NamedBundle.get(bundle, bundleGraph, this.options),
      });
      return;
    }

    this.report(event);
  };

  async report(event: ReporterEvent) {
    let reporters = await this.config.getReporters();

    for (let reporter of reporters) {
      try {
        await reporter.plugin.report({
          event,
          options: this.pluginOptions,
          logger: new PluginLogger({origin: reporter.name}),
        });
      } catch (e) {
        // We shouldn't emit a report event here as we will cause infinite loops...
        INTERNAL_ORIGINAL_CONSOLE.error(e);
      }
    }
  }

  dispose() {
    bus.off('reporterEvent', this.eventHandler);
  }
}

export function reportWorker(workerApi: WorkerApi, event: ReporterEvent) {
  if (
    event.type === 'buildProgress' &&
    (event.phase === 'optimizing' || event.phase === 'packaging')
  ) {
    // Convert any public api bundles to their internal equivalents for
    // easy serialization
    bus.emit('reporterEvent', {
      ...event,
      bundle: bundleToInternalBundle(event.bundle),
      bundleGraphRef: workerApi.resolveSharedReference(
        bundleToInternalBundleGraph(event.bundle),
      ),
    });
    return;
  }

  bus.emit('reporterEvent', event);
}

export function report(event: ReporterEvent) {
  bus.emit('reporterEvent', event);
}
