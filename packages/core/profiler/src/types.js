// @flow

export interface TraceMeasurement {
  end(): void;
}

export type TraceMeasurementData = {|
  +categories: string[],
  +args?: {[key: string]: mixed},
|};
