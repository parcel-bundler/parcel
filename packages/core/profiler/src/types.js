// @flow

export type {TraceMeasurement} from '@parcel/types-internal';

export type TraceMeasurementData = {|
  +categories: string[],
  +args?: {[key: string]: mixed},
|};
