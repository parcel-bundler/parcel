// @flow

import type {Config} from '@parcel/types';
import type {BabelConfig} from './types';

/**
 * Generates a babel config for stripping away Flow types.
 */
export default async function getFlowOptions(config: Config): BabelConfig {
  if (!(await config.isSource())) {
    return null;
  }

  return {
    plugins: [
      ['@babel/plugin-transform-flow-strip-types', {requireDirective: true}]
    ]
  };
}
