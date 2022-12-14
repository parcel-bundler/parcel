// @flow strict-local

import type {ApplicationProfilerEvent, IDisposable} from '@parcel/types';
import type {
  ApplicationProfilerMeasurement,
  ApplicationProfilerMeasurementData,
} from './types';
import {ValueEmitter} from '@parcel/events';

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
  #traceEmitter /* ValueEmitter<ApplicationProfilerEvent> */ =
    new ValueEmitter();

  #enabled /* boolean */ = false;

  onTrace(cb: (event: ApplicationProfilerEvent) => mixed): IDisposable {
    return this.#traceEmitter.addListener(cb);
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
        this.trace({
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

  get enabled(): boolean {
    return this.#enabled;
  }

  enable(): void {
    this.#enabled = true;
  }

  disable(): void {
    this.#enabled = false;
  }

  trace(event: ApplicationProfilerEvent): void {
    if (!this.#enabled) return;
    this.#traceEmitter.emit(event);
  }
}

const applicationProfiler: ApplicationProfiler = new ApplicationProfiler();

export {applicationProfiler};
