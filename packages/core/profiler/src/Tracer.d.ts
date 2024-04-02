import type {
  TraceEvent,
  IDisposable,
  PluginTracer as IPluginTracer,
} from '@parcel/types';
import type {TraceMeasurement as ITraceMeasurement} from './types';
export default class Tracer {
  #private;
  onTrace(cb: (event: TraceEvent) => unknown): IDisposable;
  wrap(name: string, fn: () => unknown): Promise<void>;
  createMeasurement(
    name: string,
    category?: string,
    argumentName?: string,
    otherArgs?: Record<string, unknown>,
  ): ITraceMeasurement | null;
  get enabled(): boolean;
  enable(): void;
  disable(): void;
  trace(event: TraceEvent): void;
}
export declare const tracer: Tracer;
type TracerOpts = {
  origin: string;
  category: string;
};
export declare class PluginTracer implements IPluginTracer {
  /** @private */
  origin: string;
  /** @private */
  category: string;
  /** @private */
  constructor(opts: TracerOpts);
  get enabled(): boolean;
  createMeasurement(
    name: string,
    category?: string,
    argumentName?: string,
    otherArgs?: Record<string, unknown>,
  ): ITraceMeasurement | null;
}
export {};
