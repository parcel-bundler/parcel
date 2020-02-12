// @flow

import type {OutputFormat} from '../types';

import * as esmodule from './esmodule';
import * as global from './global';
import * as commonjs from './commonjs';

(esmodule: OutputFormat);
(global: OutputFormat);
(commonjs: OutputFormat);

export default {
  esmodule,
  global,
  commonjs,
};
