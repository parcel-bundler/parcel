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

export class Tracer implements ITracer {
  _report /*: ReportFn */;

  constructor(report: ReportFn) {
    this._report = report;
  }

  createMeasurement(name: string): Measurement {
    this._report({
      name,
      pid,
      start: performance.now(),
      tid,
      type: 'trace',
    });
    return {
      end: () => {
        this._report({
          end: performance.now(),
          name,
          pid,
          tid,
          type: 'trace',
        });
      },
    };
  }
}
