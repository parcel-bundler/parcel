// @flow strict-local
import type {ReporterEvent} from '@parcel/types';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import {PluginLogger} from '@parcel/logger';
import type {WorkerApi} from '@parcel/workers';

import ParcelConfig from './ParcelConfig';
import registerCoreWithSerializer from './registerCoreWithSerializer';
import PluginOptions from './public/PluginOptions';
import '@parcel/cache'; // register with serializer
import '@parcel/package-manager';
import '@parcel/fs';

registerCoreWithSerializer();

export async function runReport(
  workerApi: WorkerApi,
  {
    config,
    opts,
    event,
  }: {|
    config: ParcelConfig,
    opts: PluginOptions,
    event: ReporterEvent,
  |},
) {
  let reporters = await config.getReporters();

  for (let reporter of reporters) {
    try {
      await reporter.plugin.report({
        event,
        options: opts,
        logger: new PluginLogger({origin: reporter.name}),
      });
    } catch (e) {
      throw new ThrowableDiagnostic({
        diagnostic: errorToDiagnostic(e, reporter.name),
      });
    }
  }
}
