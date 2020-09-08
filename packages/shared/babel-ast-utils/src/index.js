// @flow strict-local

import type {
  AST,
  BaseAsset,
  PluginOptions,
  SourceLocation,
} from '@parcel/types';
import type {SourceLocation as BabelSourceLocation} from '@babel/types';

import path from 'path';
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
|}): Promise<{|content: string, map: ?SourceMap|}> {
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
  let originalSourceMap = await asset.getMap();
  if (generated.rawMappings) {
    map = new SourceMap(options.projectRoot);
    map.addIndexedMappings(generated.rawMappings);
    if (originalSourceMap) {
      map.extends(originalSourceMap.toBuffer());
    }
  } else {
    map = originalSourceMap;
  }

  return {
    content: generated.code,
    map,
  };
}

export function convertBabelLoc(loc: ?BabelSourceLocation): ?SourceLocation {
  if (!loc) return null;
  let {filename, start, end} = loc;
  if (filename == null) return null;
  return {
    filePath: path.normalize(filename),
    start: {
      line: start.line,
      column: start.column + 1,
    },
    // - Babel's columns are exclusive, ours are inclusive (column - 1)
    // - Babel has 0-based columns, ours are 1-based (column + 1)
    // = +-0
    end: {
      line: end.line,
      column: end.column,
    },
  };
}
