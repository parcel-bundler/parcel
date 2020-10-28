// @flow strict-local

import type {Tracer as ITracer, Measurement} from '@parcel/types';
import type {ReportFn} from './types';

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

export default class Tracer implements ITracer {
  _report /*: ReportFn */;

  constructor(report: ReportFn) {
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

  createMeasurement(name: string): Measurement {
    const start = performance.now();
    return {
      end: () => {
        this._report({
          name,
          pid,
          tid,
          duration: performance.now() - start,
          ts: start,
          type: 'trace',
        });
      },
    };
  }
}
