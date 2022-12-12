// @flow strict-local

import type {
  ApplicationProfilerReportFn,
  ApplicationProfilerMeasurement,
  ApplicationProfilerMeasurementData,
} from './types';

// $FlowFixMe
import {performance as _performance} from 'perf_hooks';

let tid;
try {
  tid = require('worker_threads').threadId;
} catch {
  tid = 0;
}

const performance: Performance = _performance;
const pid = process.pid;

export default class ApplicationProfiler {
  _report /*: ApplicationProfilerReportFn */;

  constructor(report: ApplicationProfilerReportFn) {
    this._report = report;
  }

  async wrap(name: string, fn: () => mixed): Promise<void> {
    let measurement = this.createMeasurement(name);
    try {
      await fn();
    } finally {
      measurement.end();
    }
  }

  createMeasurement(
    name: string,
    data?: ApplicationProfilerMeasurementData = {categories: ['Core']},
  ): ApplicationProfilerMeasurement {
    const start = performance.now();
    return {
      end: () => {
        this._report({
          type: 'trace',
          name,
          pid,
          tid,
          duration: performance.now() - start,
          ts: start,
          ...data,
        });
      },
    };
  }
}

const applicationProfiler: ApplicationProfiler = new ApplicationProfiler(
  event => {
    // eslint-disable-next-line no-console
    console.log('app profiler event', event.name);
  },
);

export {applicationProfiler};
