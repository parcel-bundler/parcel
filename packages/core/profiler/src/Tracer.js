// @flow strict-local

import type {
  TraceEvent,
  IDisposable,
  MeasurementOptions,
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

let traceId = 0;

class TraceMeasurement implements ITraceMeasurement {
  #active: boolean = true;
  // $FlowFixMe[unclear-type]
  #args: {traceId: string, [key: string]: any};
  #categories: string[];
  #name: string;
  #pid: number;
  #start: number;
  #tid: number;

  constructor(
    tracer: Tracer,
    name: string,
    pid: number,
    tid: number,
    // $FlowFixMe[unclear-type]
    data: any,
  ) {
    this.#name = name;
    this.#pid = pid;
    this.#tid = tid;
    this.#start = performance.now();
    this.#args = {
      traceId: String(traceId++),
      ...(data.args ?? {}),
    };

    this.#categories = data.categories;

    tracer.trace({
      type: 'traceStart',
      args: this.#args,
      categories: this.#categories,
      name: this.#name,
      pid: this.#pid,
      tid: this.#tid,
      ts: this.#start,
    });
  }

  get traceId(): string {
    return this.#args.traceId;
  }

  end() {
    if (!this.#active) return;
    const duration = performance.now() - this.#start;

    tracer.trace({
      type: 'trace',
      args: this.#args,
      categories: this.#categories,
      duration,
      name: this.#name,
      pid: this.#pid,
      tid: this.#tid,
      ts: this.#start,
    });

    this.#active = false;
  }
}

let id = 1;

export default class Tracer {
  #traceEmitter: ValueEmitter<TraceEvent> = new ValueEmitter();

  #enabled: boolean = false;

  id: string;
  pid: number;
  tid: number;

  constructor() {
    this.id = String(id++);
    this.pid = pid;
    this.tid = tid;
  }

  onTrace(cb: (event: TraceEvent) => mixed): IDisposable {
    return this.#traceEmitter.addListener(cb);
  }

  createTraceMeasurement({
    args = {},
    categories,
    name,
  }: MeasurementOptions): TraceMeasurement {
    if (!tracer.enabled) {
      throw new Error(
        'Unable to create a trace measurement when tracing is disabled',
      );
    }

    return new TraceMeasurement(this, name, pid, tid, {
      categories,
      args,
    });
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
      categories: [
        `${this.category}:${this.origin}${
          typeof category === 'string' ? `:${category}` : ''
        }`,
      ],
      args,
    };

    return new TraceMeasurement(tracer, name, pid, tid, data);
  }

  createTraceMeasurement(options: MeasurementOptions): TraceMeasurement {
    return tracer.createTraceMeasurement({
      ...options,
      // $FlowFixMe[cannot-spread-inexact]
      args: {
        origin: this.origin,
        ...(options.args ?? {}),
      },
      categories: [this.category, ...options.categories],
    });
  }
}
