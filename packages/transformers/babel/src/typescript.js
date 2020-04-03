// @flow
import path from 'path';

import type {Config} from '@parcel/types';
import type {BabelConfig} from './types';

import plugin from '@babel/plugin-transform-typescript';

export default function getTypescriptOptions(config: Config): BabelConfig {
  return {
    plugins: [[plugin, {isTSX: path.extname(config.searchPath) === '.tsx'}]],
  };
}
