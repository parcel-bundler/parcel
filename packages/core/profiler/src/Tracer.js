// @flow strict-local

import type {
  TraceEvent,
  IDisposable,
  PluginTracer as IPluginTracer,
} from '@parcel/types';
import type {
  TraceMeasurement as ITraceMeasurement,
  TraceMeasurementData,
} from './types';
// @ts-ignore
import {ValueEmitter} from '@parcel/events';

import {performance} from 'perf_hooks';

let tid;
try {
  tid = require('worker_threads').threadId;
} catch {
  tid = 0;
}

const pid = process.pid;

class TraceMeasurement implements ITraceMeasurement {
  #active: boolean = true;
  #name: string;
  #pid: number;
  #tid: number;
  #start: number;
  // $FlowFixMe
  #data: any;
  constructor(tracer: Tracer, name, pid, tid, data) {
    this.#name = name;
    this.#pid = pid;
    this.#tid = tid;
    this.#start = performance.now();
    this.#data = data;
  }

  end() {
    if (!this.#active) return;
    const duration = performance.now() - this.#start;
    tracer.trace({
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

export default class Tracer {
  #traceEmitter: ValueEmitter<TraceEvent> = new ValueEmitter();

  #enabled: boolean = false;

  onTrace(cb: (event: TraceEvent) => mixed): IDisposable {
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
    category: string = 'Core',
    argumentName?: string,
    otherArgs?: {[key: string]: mixed},
  ): ITraceMeasurement | null {
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

    const data: TraceMeasurementData = {
      categories: [category],
      args,
    };

    return new TraceMeasurement(this, name, pid, tid, data);
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

  trace(event: TraceEvent): void {
    if (!this.#enabled) return;
    this.#traceEmitter.emit(event);
  }
}

export const tracer: Tracer = new Tracer();

type TracerOpts = {|
  origin: string,
  category: string,
|};
export class PluginTracer implements IPluginTracer {
  /** @private */
  origin: string;

  /** @private */
  category: string;

  /** @private */
  constructor(opts: TracerOpts) {
    this.origin = opts.origin;
    this.category = opts.category;
  }

  get enabled(): boolean {
    return tracer.enabled;
  }

  createMeasurement(
    name: string,
    category?: string,
    argumentName?: string,
    otherArgs?: {[key: string]: mixed},
  ): ITraceMeasurement | null {
    return tracer.createMeasurement(
      name,
      `${this.category}:${this.origin}${
        typeof category === 'string' ? `:${category}` : ''
      }`,
      argumentName,
      otherArgs,
    );
  }
}
