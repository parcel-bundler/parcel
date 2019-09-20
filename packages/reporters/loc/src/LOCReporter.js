// @flow strict-local

import type {ParcelOptions, ReporterEvent} from '@parcel/types';

import {Reporter} from '@parcel/plugin';
import Logger from '@parcel/logger';
import lineCounter from './lineCounter';

const LOG_LEVELS = {
  none: 0,
  error: 1,
  warn: 2,
  info: 3,
  progress: 3,
  success: 3,
  verbose: 4
};

export default new Reporter({
  async report(event: ReporterEvent, options: ParcelOptions) {
    let logLevelFilter = options.logLevel || 'info';

    if (
      event.type !== 'buildSuccess' ||
      LOG_LEVELS[logLevelFilter] < LOG_LEVELS.info
    ) {
      return;
    }

    event.bundleGraph.getBundles();
    Logger.info(
      'Number of lines: ' + (await lineCounter(event.bundleGraph.getBundles()))
    );
  }
});
