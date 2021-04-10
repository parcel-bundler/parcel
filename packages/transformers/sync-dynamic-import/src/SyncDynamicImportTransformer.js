// @flow

import semver from 'semver';
import {Transformer} from '@parcel/plugin';
import * as babelCore from '@babel/core';
import {generate, parse} from '@parcel/babel-ast-utils';
import {relativeUrl} from '@parcel/utils';
import packageJson from '../package.json';
import syncDynamicImportPlugin from './babel/babel-plugin-sync-dynamic-import';

const transformerVersion: mixed = packageJson.version;

const IMPORT_RE = /\bimport\b/;

export default (new Transformer({
  canReuseAST({ast}) {
    return ast.type === 'babel' && semver.satisfies(ast.version, '^7.0.0');
  },

  async parse({asset, options}) {
    let code = await asset.getCode();
    if (!IMPORT_RE.test(code)) {
      return null;
    }

    return parse({
      asset,
      code,
      options,
      plugins: [
        'jsx',
        'typescript',
        'classProperties',
        ['moduleAttributes', {version: 'may-2020'}],
      ],
    });
  },

  async transform({asset, options}) {
    let ast = await asset.getAST();
    if (!ast) {
      return [asset];
    }

    let code = asset.isASTDirty() ? null : await asset.getCode();

    const res = await babelCore.transformFromAstAsync(
      ast.program,
      code ?? undefined,
      {
        code: false,
        ast: true,
        filename: asset.filePath,
        babelrc: false,
        configFile: false,
        parserOpts: {
          sourceFilename: relativeUrl(options.projectRoot, asset.filePath),
          allowReturnOutsideFunction: true,
          strictMode: false,
          sourceType: 'module',
        },
        caller: {
          name: 'parcel',
          version: transformerVersion,
          targets: JSON.stringify({node: 'current'}),
        },
        // ATLASSIAN: the react-loadable plugin adds some fields to the Loadable calls that are required for hydration
        plugins: ['react-loadable/babel', syncDynamicImportPlugin],
      },
    );

    asset.setAST({
      type: 'babel',
      version: '7.0.0',
      program: res.ast,
    });

    return [asset];
  },

  generate({asset, ast, options}) {
    return generate({asset, ast, options});
  },
}): Transformer);
