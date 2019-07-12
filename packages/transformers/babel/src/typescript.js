// @flow
import path from 'path';

import {IConfig} from '@parcel/types';
import type {BabelConfig} from './types';

export default function getTypescriptOptions(config: IConfig): BabelConfig {
  return {
    plugins: [
      [
        '@babel/plugin-transform-typescript',
        {isTSX: path.extname(config.searchPath) === '.tsx'}
      ]
    ]
  };
}
