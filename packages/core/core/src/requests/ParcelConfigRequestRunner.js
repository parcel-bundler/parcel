// @flow strict-local
import type WorkerFarm from '@parcel/workers';
import type RequestTracker, {RequestRunnerAPI} from '../RequestTracker';
import type {ParcelOptions, ProcessedParcelConfig} from '../types';

import loadParcelConfig from '../loadParcelConfig';
import {RequestRunner} from '../RequestTracker';

type ConfigAndRef = {|
  config: ProcessedParcelConfig,
  configRef: number,
|};

export default class ParcelConfigRequestRunner extends RequestRunner<
  null,
  ConfigAndRef,
> {
  options: ParcelOptions;
  workerFarm: WorkerFarm;
  disposeConfigRef: () => Promise<mixed>;

  constructor(opts: {|
    tracker: RequestTracker,
    options: ParcelOptions,
    workerFarm: WorkerFarm,
  |}) {
    super(opts);
    this.workerFarm = opts.workerFarm;
    this.options = opts.options;
    this.type = 'parcel_config_request';
  }

  async run(request: null, api: RequestRunnerAPI): Promise<ConfigAndRef> {
    let {config, extendedFiles} = await loadParcelConfig(this.options);
    let processedConfig = config.getConfig();
    let {ref, dispose} = await this.workerFarm.createSharedReference(
      processedConfig,
    );
    this.disposeConfigRef && (await this.disposeConfigRef());
    this.disposeConfigRef = dispose;

    api.invalidateOnFileUpdate(config.filePath);
    api.invalidateOnFileDelete(config.filePath);

    for (let filePath of extendedFiles) {
      api.invalidateOnFileUpdate(filePath);
      api.invalidateOnFileDelete(filePath);
    }

    if (config.filePath === this.options.defaultConfig?.filePath) {
      api.invalidateOnFileCreate('**/.parcelrc');
    }

    // Need to do this because of reinstantiate the shared reference
    api.invalidateOnStartup();

    let result = {config: processedConfig, configRef: ref};
    api.storeResult(result);
    return result;
  }
}
