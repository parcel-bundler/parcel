// @flow

import {IConfig} from '@parcel/types';
import type {BabelConfig} from './types';

/**
 * Generates a babel config for stripping away Flow types.
 */
export default async function getFlowOptions(config: IConfig): BabelConfig {
  if (!(await config.isSource())) {
    return null;
  }

  return {
    plugins: [
      ['@babel/plugin-transform-flow-strip-types', {requireDirective: true}]
    ]
  };
}
