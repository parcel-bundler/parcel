// @flow

export type {TraceMeasurement} from '@atlaspack/types-internal';

export type TraceMeasurementData = {|
  +categories: string[],
  +args?: {[key: string]: mixed},
|};
