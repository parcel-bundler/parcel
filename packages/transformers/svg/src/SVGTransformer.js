// @flow

import {Transformer} from '@parcel/plugin';
import {JSDOM} from 'jsdom';
import nullthrows from 'nullthrows';
import semver from 'semver';
import collectDependencies from './dependencies';

export default (new Transformer({
  canReuseAST({ast}) {
    return ast.type === 'jsdom' && semver.satisfies(ast.version, '^16.6.0');
  },

  async parse({asset}) {
    return {
      type: 'jsdom',
      version: '16.6.0',
      program: new JSDOM(await asset.getBuffer(), {
        contentType: 'image/svg+xml',
      }),
    };
  },

  async transform({asset}) {
    const ast = nullthrows(await asset.getAST());

    collectDependencies(asset, ast);

    return [asset];
  },

  generate({ast}) {
    return {
      content: ast.program.serialize(),
    };
  },
}): Transformer);
