/// <reference types="node" />
import type {Profile} from './SamplingProfiler';
import type {Writable} from 'stream';
import {Tracer} from 'chrome-trace-event';
export default class Trace {
  tracer: Tracer;
  tid: number;
  eventId: number;
  constructor();
  getEventId(): number;
  init(ts: number): void;
  addCPUProfile(name: string, profile: Profile): void;
  pipe(writable: Writable): Writable;
  flush(): void;
}
