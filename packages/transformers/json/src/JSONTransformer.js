// @flow

import {Transformer} from '@parcel/plugin';
import json5 from 'json5';
import semver from 'semver';

export default (new Transformer({
  canReuseAST({ast}) {
    return ast.type == 'json5' && semver.satisfies(ast.version, '^2.1.0');
  },
  async parse({asset}) {
    // This indicates a previous transformer (e.g. WebExt) has applied special
    // handling to this already
    if (asset.meta.hasDependencies === false) {
      return null;
    }
    return {
      type: 'json5',
      version: '2.1.0',
      program: json5.parse(await asset.getCode())
    }
  },
  async transform({asset}) {
    asset.type = 'js';
    // Use JSON.parse("...") for faster script parsing, see
    // https://v8.dev/blog/cost-of-javascript-2019#json.
    // Apply `JSON.stringify` twice to make it a valid string literal.
    asset.setCode(
      `module.exports = JSON.parse(${JSON.stringify(
        JSON.stringify(await asset.getAST()),
      )});`,
    );
    return [asset];
  },
}): Transformer);
