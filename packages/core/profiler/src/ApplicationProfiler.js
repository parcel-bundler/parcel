// @flow strict-local

import type {
  ApplicationProfilerEvent,
  IDisposable,
  PluginApplicationProfiler as IPluginApplicationProfiler,
} from '@parcel/types';
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
      measurement && measurement.end();
    }
  }

  createMeasurement(
    name: string,
    category?: string = 'Core',
    argumentName?: string,
    otherArgs?: {[key: string]: mixed},
  ): ApplicationProfilerMeasurement | null {
    if (!this.enabled) return null;

    // We create `args` in a fairly verbose way to avoid object
    // allocation where not required.
    let args: {[key: string]: mixed};
    if (typeof argumentName === 'string') {
      args = {name: argumentName};
    }
    if (typeof otherArgs === 'object') {
      if (typeof args == 'undefined') {
        args = {};
      }
      for (const [k, v] of Object.entries(otherArgs)) {
        args[k] = v;
      }
    }

    const data: ApplicationProfilerMeasurementData = {
      categories: [category],
      args,
    };

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

export const applicationProfiler: ApplicationProfiler =
  new ApplicationProfiler();

export class PluginApplicationProfiler implements IPluginApplicationProfiler {
  get enabled(): boolean {
    return applicationProfiler.enabled;
  }

  createMeasurement(
    name: string,
    category?: string = 'Plugin',
    argumentName?: string,
    otherArgs?: {[key: string]: mixed},
  ): ApplicationProfilerMeasurement | null {
    return applicationProfiler.createMeasurement(
      name,
      category,
      argumentName,
      otherArgs,
    );
  }
}
