// @flow strict-local
import type {ReporterEvent} from '@parcel/types';
import type {ParcelOptions} from './types';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import {PluginLogger} from '@parcel/logger';
import type {WorkerApi} from '@parcel/workers';
import '@parcel/cache'; // register with serializer
import '@parcel/package-manager';
import '@parcel/fs';

import {NamedBundle} from './public/Bundle';
import ParcelConfig from './ParcelConfig';
import PluginOptions from './public/PluginOptions';
import BundleGraph from './public/BundleGraph';
import registerCoreWithSerializer from './registerCoreWithSerializer';

registerCoreWithSerializer();

export async function runReport(
  workerApi: WorkerApi,
  {
    config,
    opts,
    event,
  }: {|
    config: ParcelConfig,
    opts: ParcelOptions,
    event: ReporterEvent,
  |},
) {
  let reporters = await config.getReporters();
  let pluginOptions = new PluginOptions(opts);

  if (event.bundle != null) {
    // $FlowFixMe
    event = {
      ...event,
      bundle: new NamedBundle(
        // $FlowFixMe
        event.bundle,
        // $FlowFixMe
        event.bundleGraph,
        this.options,
      ),
    };
  }

  if (event.bundleGraph != null) {
    // $FlowFixMe
    event.bundleGraph = new BundleGraph(event.bundleGraph, opts);
  }

  for (let reporter of reporters) {
    try {
      await reporter.plugin.report({
        event,
        options: pluginOptions,
        logger: new PluginLogger({origin: reporter.name}),
      });
    } catch (e) {
      throw new ThrowableDiagnostic({
        diagnostic: errorToDiagnostic(e, reporter.name),
      });
    }
  }
}
