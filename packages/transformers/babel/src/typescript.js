// @flow
import path from 'path';

import type {Config} from '@parcel/types';
import type {BabelConfig} from './types';

export default function getTypescriptOptions(
  config: Config,
  pragma: ?string,
  pragmaFrag: ?string,
): BabelConfig {
  return {
    plugins: [
      [
        '@babel/plugin-transform-typescript',
        {
          isTSX: path.extname(config.searchPath) === '.tsx',
          // Needed because of https://github.com/babel/babel/issues/12585
          jsxPragma: pragma,
          jsxPragmaFrag: pragmaFrag,
        },
      ],
    ],
  };
}
