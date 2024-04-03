// @flow

export type {TraceMeasurement} from '@parcel/types';

export type TraceMeasurementData = {|
  +categories: string[],
  +args?: {[key: string]: mixed},
|};
