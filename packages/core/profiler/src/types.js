// @flow

export interface ApplicationProfilerMeasurement {
  end(): void;
}

export type ApplicationProfilerMeasurementData = {|
  +categories: string[],
  +args?: {[key: string]: mixed},
|};
