// @flow strict-local

import type {
  ApplicationProfilerEvent,
  IDisposable,
  PluginApplicationProfiler as IPluginApplicationProfiler,
} from '@parcel/types';
import type {
  ApplicationProfilerMeasurement as IApplicationProfilerMeasurement,
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

class ApplicationProfilerMeasurement
  implements IApplicationProfilerMeasurement
{
  #active /* boolean */ = true;
  #name /* string */;
  #pid /* number */;
  #tid /* number */;
  #start /* number */;
  #data /* any */;
  constructor(applicationProfiler: ApplicationProfiler, name, pid, tid, data) {
    this.#name = name;
    this.#pid = pid;
    this.#tid = tid;
    this.#start = performance.now();
    this.#data = data;
  }

  end() {
    if (!this.#active) return;
    const duration = performance.now() - this.#start;
    applicationProfiler.trace({
      type: 'trace',
      name: this.#name,
      pid: this.#pid,
      tid: this.#tid,
      duration,
      ts: this.#start,
      ...this.#data,
    });
    this.#active = false;
  }
}

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
  ): IApplicationProfilerMeasurement | null {
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

    return new ApplicationProfilerMeasurement(this, name, pid, tid, data);
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

type ApplicationProfilerOpts = {|
  origin: string,
  category: string,
|};
export class PluginApplicationProfiler implements IPluginApplicationProfiler {
  /** @private */
  origin: string;

  /** @private */
  category: string;

  /** @private */
  constructor(opts: ApplicationProfilerOpts) {
    this.origin = opts.origin;
    this.category = opts.category;
  }

  get enabled(): boolean {
    return applicationProfiler.enabled;
  }

  createMeasurement(
    name: string,
    category?: string,
    argumentName?: string,
    otherArgs?: {[key: string]: mixed},
  ): IApplicationProfilerMeasurement | null {
    return applicationProfiler.createMeasurement(
      name,
      `${this.category}:${this.origin}${
        typeof category === 'string' ? `:${category}` : ''
      }`,
      argumentName,
      otherArgs,
    );
  }
}
