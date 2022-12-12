// @flow

// Loosely modeled on Chrome's Trace Event format:
// https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU/preview

export type ApplicationProfilerEvent = {|
  +type: 'trace',
  +ts: number,
  +duration: number,
  +name: string,
  +tid: number,
  +pid: number,
  +categories: string[],
  +args?: {[key: string]: mixed},
|};

export type ApplicationProfilerMeasurement = {|end: () => void|};

export type ApplicationProfilerMeasurementData = {|
  +categories: string[],
  +args?: {[key: string]: mixed},
|};

export type ApplicationProfilerReportFn = (
  event: ApplicationProfilerEvent,
) => void | Promise<void>;
