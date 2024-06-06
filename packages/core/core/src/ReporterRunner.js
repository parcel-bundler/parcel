// @flow strict-local

import type {ReporterEvent, Reporter} from '@parcel/types';
import type {WorkerApi} from '@parcel/workers';
import type {Bundle as InternalBundle, ParcelOptions} from './types';
import type {LoadedPlugin} from './ParcelConfig';

import invariant from 'assert';
import {
  bundleToInternalBundle,
  bundleToInternalBundleGraph,
  NamedBundle,
} from './public/Bundle';
import WorkerFarm, {bus} from '@parcel/workers';
import logger, {
  patchConsole,
  unpatchConsole,
  PluginLogger,
  INTERNAL_ORIGINAL_CONSOLE,
} from '@parcel/logger';
import PluginOptions from './public/PluginOptions';
import BundleGraph from './BundleGraph';
import {tracer, PluginTracer} from '@parcel/profiler';
import {anyToDiagnostic} from '@parcel/diagnostic';

type Opts = {|
  options: ParcelOptions,
  reporters: Array<LoadedPlugin<Reporter>>,
  workerFarm: WorkerFarm,
|};

const instances: Set<ReporterRunner> = new Set();

export default class ReporterRunner {
  workerFarm: WorkerFarm;
  errors: Error[];
  options: ParcelOptions;
  pluginOptions: PluginOptions;
  reporters: Array<LoadedPlugin<Reporter>>;

  constructor(opts: Opts) {
    this.errors = [];
    this.options = opts.options;
    this.reporters = opts.reporters;
    this.workerFarm = opts.workerFarm;
    this.pluginOptions = new PluginOptions(this.options);

    logger.onLog(event => this.report(event));
    tracer.onTrace(event => this.report(event));

    bus.on('reporterEvent', this.eventHandler);
    instances.add(this);

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

  async report(unsanitisedEvent: ReporterEvent) {
    let event: ReporterEvent = unsanitisedEvent;
    if (event.diagnostics) {
      // Sanitise input before passing to reporters
      // $FlowFixMe too complex to narrow down by type
      event = {
        ...event,
        diagnostics: anyToDiagnostic(event.diagnostics),
      };
    }
    for (let reporter of this.reporters) {
      let measurement;
      try {
        // To avoid an infinite loop we don't measure trace events, as they'll
        // result in another trace!
        if (event.type !== 'trace') {
          measurement = tracer.createMeasurement(reporter.name, 'reporter');
        }
        await reporter.plugin.report({
          // $FlowFixMe
          event,
          options: this.pluginOptions,
          logger: new PluginLogger({origin: reporter.name}),
          tracer: new PluginTracer({
            origin: reporter.name,
            category: 'reporter',
          }),
        });
      } catch (reportError) {
        if (event.type !== 'buildSuccess') {
          // This will be captured by consumers
          INTERNAL_ORIGINAL_CONSOLE.error(reportError);
        }

        this.errors.push(reportError);
      } finally {
        measurement && measurement.end();
      }
    }
  }

  dispose() {
    bus.off('reporterEvent', this.eventHandler);
    instances.delete(this);
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

export async function report(event: ReporterEvent): Promise<void> {
  await Promise.all([...instances].map(instance => instance.report(event)));
}
