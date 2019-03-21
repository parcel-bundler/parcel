// @flow

import {minify} from 'terser';
import {serialize} from 'serialize-to-js';

export default function serializeObject(
  obj: mixed,
  shouldMinify: boolean = false
) {
  let code = `module.exports = ${serialize(obj)};`;

  if (shouldMinify) {
    let minified = minify(code);
    if (minified.error) {
      throw minified.error;
    }

    code = minified.code;
  }

  return code;
}
