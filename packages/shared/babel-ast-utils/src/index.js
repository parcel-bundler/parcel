// @flow strict-local

import type {AST, BaseAsset, PluginOptions} from '@parcel/types';

import babelGenerate from '@babel/generator';
import {parse as babelParse} from '@babel/parser';
import SourceMap from '@parcel/source-map';
import {relativeUrl} from '@parcel/utils';
import {babelErrorEnhancer} from './babelErrorUtils';

export {babelErrorEnhancer};

export function parse({
  asset,
  code,
  options,
}: {|
  asset: BaseAsset,
  code: string,
  options: PluginOptions,
|}): AST {
  return {
    type: 'babel',
    version: '7.0.0',
    program: babelParse(code, {
      sourceFilename: relativeUrl(options.projectRoot, asset.filePath),
      allowReturnOutsideFunction: true,
      strictMode: false,
      sourceType: 'module',
      plugins: ['exportDefaultFrom', 'exportNamespaceFrom', 'dynamicImport'],
    }),
  };
}

export async function generate({
  asset,
  ast,
  options,
}: {|
  asset: BaseAsset,
  ast: AST,
  options: PluginOptions,
|}) {
  let sourceFileName: string = relativeUrl(options.projectRoot, asset.filePath);
  let generated;
  try {
    generated = babelGenerate(ast.program, {
      sourceMaps: options.sourceMaps,
      sourceFileName: sourceFileName,
    });
  } catch (e) {
    throw await babelErrorEnhancer(e, asset);
  }

  return {
    code: generateGlobals(asset) + generated.code,
    map:
      generated.rawMappings != null
        ? new SourceMap(generated.rawMappings, {
            [sourceFileName]: null,
          })
        : null,
  };
}

function generateGlobals(asset) {
  let code = '';
  if (asset.meta.globals && asset.meta.globals.size > 0) {
    code =
      Array.from(asset.meta.globals.values())
        .map(g => (g ? g.code : ''))
        .join('\n') + '\n';
  }
  delete asset.meta.globals;
  return code;
}
