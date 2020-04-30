// @flow strict-local

import type {AST, BaseAsset, PluginOptions} from '@parcel/types';

import babelGenerate from '@babel/generator';
import {parse as babelParse} from '@babel/parser';
import SourceMap from '@parcel/source-map';
import {relativeUrl} from '@parcel/utils';
import {babelErrorEnhancer} from './babelErrorUtils';

export {babelErrorEnhancer};

export async function parse({
  asset,
  code,
  options,
}: {|
  asset: BaseAsset,
  code: string,
  options: PluginOptions,
|}): Promise<AST> {
  try {
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
  } catch (e) {
    throw await babelErrorEnhancer(e, asset);
  }
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

  let map = null;
  if (generated.rawMappings) {
    map = new SourceMap();
    map.addIndexedMappings(generated.rawMappings);

    let originalMap = await asset.getMapBuffer();
    if (originalMap) {
      map.extends(originalMap);
    }
  }

  return {
    content: generated.code,
    map,
  };
}
