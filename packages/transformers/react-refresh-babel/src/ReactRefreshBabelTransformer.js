// @flow

import semver from 'semver';
import {Transformer} from '@parcel/plugin';
import {relativeUrl} from '@parcel/utils';
import SourceMap from '@parcel/source-map';
import {transformFromAst} from '@babel/core';
import generate from '@babel/generator';
import {parse} from '@babel/parser';

function shouldExclude(asset, options) {
  return (
    !asset.env.isBrowser() ||
    !options.hot ||
    !asset.isSource ||
    asset.filePath.includes('packages/runtimes')
  );
}

export default new Transformer({
  canReuseAST({ast}) {
    return ast.type === 'babel' && semver.satisfies(ast.version, '^7.0.0');
  },

  async parse({asset, options}) {
    let code = await asset.getCode();
    if (shouldExclude(asset, options)) {
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
        plugins: [
          'exportDefaultFrom',
          'exportNamespaceFrom',
          'dynamicImport',
          'jsx'
        ]
      })
    };
  },

  async transform({asset, options}) {
    asset.type = 'js';
    let ast = asset.ast;
    if (!ast || shouldExclude(asset, options)) {
      return [asset];
    }

    let reactRefreshBabelPlugin = (await options.packageManager.resolve(
      'react-refresh/babel',
      __filename
    )).resolved;

    let code = await asset.getCode();
    let transformResult = transformFromAst(ast.program, code, {
      code: false,
      ast: true,
      filename: asset.filePath,
      babelrc: false,
      configFile: false,
      plugins: [reactRefreshBabelPlugin]
    });
    ast.program = transformResult.ast;

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
