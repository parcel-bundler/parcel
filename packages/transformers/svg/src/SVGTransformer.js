// @flow

import {Transformer} from '@parcel/plugin';
import nullthrows from 'nullthrows';
import semver from 'semver';
import collectDependencies from './dependencies';
import parse from 'posthtml-parser';
import render from 'posthtml-render';

export default (new Transformer({
  canReuseAST({ast}) {
    return ast.type === 'posthtml' && semver.satisfies(ast.version, '^0.4.0');
  },

  async parse({asset}) {
    return {
      type: 'posthtml',
      version: '0.4.1',
      program: parse(await asset.getCode(), {
        directives: [
          {
            name: /^\?/,
            start: '<',
            end: '>',
          },
        ],
        sourceLocations: true,
        xmlMode: true,
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
      content: render(ast.program),
    };
  },
}): Transformer);
