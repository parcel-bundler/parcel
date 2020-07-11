// @flow

import type {StringLiteral, Statement} from '@babel/types';

import semver from 'semver';
import path from 'path';
import {generate, parse} from '@parcel/babel-ast-utils';
import {Transformer} from '@parcel/plugin';
import {relativePath} from '@parcel/utils';
import template from '@babel/template';
import * as t from '@babel/types';

const WRAPPER = path.join(__dirname, 'helpers', 'helpers.js');

const wrapper = template.statements<{|
  helper: StringLiteral,
  module: Array<Statement>,
|}>(`
var helpers = require(%%helper%%);
var prevRefreshReg = window.$RefreshReg$;
var prevRefreshSig = window.$RefreshSig$;
helpers.prelude(module);

try {
  %%module%%
  helpers.postlude(module);
} finally {
  window.$RefreshReg$ = prevRefreshReg;
  window.$RefreshSig$ = prevRefreshSig;
}
`);

function shouldExclude(asset, options) {
  return (
    !asset.isSource ||
    !options.hot ||
    !asset.env.isBrowser() ||
    options.mode !== 'development' ||
    !asset.getDependencies().find(v => v.moduleSpecifier === 'react')
  );
}

export default new Transformer({
  canReuseAST({ast}) {
    return ast.type === 'babel' && semver.satisfies(ast.version, '^7.0.0');
  },

  async parse({asset, options}) {
    if (shouldExclude(asset, options)) {
      return null;
    }

    return parse({
      asset,
      code: await asset.getCode(),
      options,
    });
  },

  async transform({asset, options}) {
    let ast = await asset.getAST();
    if (!ast || shouldExclude(asset, options)) {
      return [asset];
    }

    let wrapperPath = relativePath(path.dirname(asset.filePath), WRAPPER);
    if (!wrapperPath.startsWith('.')) {
      wrapperPath = './' + wrapperPath;
    }

    ast.program.program.body = wrapper({
      helper: t.stringLiteral(wrapperPath),
      module: ast.program.program.body,
    });
    asset.setAST(ast);

    // The JSTransformer has already run, do it manually
    asset.addDependency({
      moduleSpecifier: wrapperPath,
    });

    return [asset];
  },

  generate({asset, ast, options}) {
    return generate({asset, ast, options});
  },
});
