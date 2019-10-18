// @flow

import semver from 'semver';
import path from 'path';
import {Transformer} from '@parcel/plugin';
import {relativeUrl} from '@parcel/utils';
import SourceMap from '@parcel/source-map';
import generate from '@babel/generator';
import {parse} from '@babel/parser';
import template from '@babel/template';
import * as t from '@babel/types';

const WRAPPER = path.join(__dirname, 'loaders', 'helpers.js');

const loader = template(`
var Refresh = require('react-refresh/runtime');
var helpers = require(%%helper%%);
var prevRefreshReg = window.$RefreshReg$;
var prevRefreshSig = window.$RefreshSig$;
helpers.prelude(Refresh, module);

try {
  %%module%%
} finally {
  window.$RefreshReg$ = prevRefreshReg;
  window.$RefreshSig$ = prevRefreshSig;
}

helpers.postlude(Refresh, module);`);

async function shouldExclude(asset, options) {
  let pkg = await asset.getPackage();
  return (
    !asset.env.isBrowser() ||
    !options.hot ||
    !asset.isSource ||
    (pkg &&
      pkg.name &&
      (pkg.name.startsWith('@parcel/runtime-') ||
        pkg.name.includes('parcel-runtime-'))) ||
    !asset.getDependencies().find(v => v.moduleSpecifier === 'react')
  );
}

export default new Transformer({
  canReuseAST({ast}) {
    return ast.type === 'babel' && semver.satisfies(ast.version, '^7.0.0');
  },

  async parse({asset, options}) {
    let code = await asset.getCode();
    if (await shouldExclude(asset, options)) {
      return null;
    }

    return {
      type: 'babel',
      version: '7.0.0',
      isDirty: false,
      program: parse(code, {
        filename: this.name,
        allowReturnOutsideFunction: true,
        strictMode: false,
        sourceType: 'module',
        plugins: ['exportDefaultFrom', 'exportNamespaceFrom', 'dynamicImport']
      })
    };
  },

  async transform({asset, options}) {
    asset.type = 'js';
    if (!asset.ast || (await shouldExclude(asset, options))) {
      return [asset];
    }

    let ast = asset.ast;
    let wrapperPath = path.relative(path.dirname(asset.filePath), WRAPPER);
    ast.program.program.body = loader({
      helper: t.stringLiteral(wrapperPath),
      module: ast.program.program.body
    });
    ast.isDirty = true;

    asset.addDependency({
      moduleSpecifier: 'react-refresh/runtime'
    });

    asset.addDependency({
      moduleSpecifier: wrapperPath
    });

    return [asset];
  },

  async generate({asset, options}) {
    let code = await asset.getCode();
    let res = {
      code
    };

    let ast = asset.ast;
    if (ast && ast.isDirty !== false) {
      let sourceFileName: string = relativeUrl(
        options.projectRoot,
        asset.filePath
      );

      let generated = generate(
        ast.program,
        {
          sourceMaps: options.sourceMaps,
          sourceFileName: sourceFileName
        },
        code
      );

      res.code = generated.code;
      // $FlowFixMe...
      res.map = new SourceMap(generated.rawMappings, {
        [sourceFileName]: null
      });
    }

    if (asset.meta.globals && asset.meta.globals.size > 0) {
      res.code =
        Array.from(asset.meta.globals.values())
          .map(g => (g ? g.code : ''))
          .join('\n') +
        '\n' +
        res.code;
    }
    delete asset.meta.globals;

    return res;
  }
});
