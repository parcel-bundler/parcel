// @flow

export type ApplicationProfilerMeasurement = {|end: () => void|};

export type ApplicationProfilerMeasurementData = {|
  +categories: string[],
  +args?: {[key: string]: mixed},
|};
