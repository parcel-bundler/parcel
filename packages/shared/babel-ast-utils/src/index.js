// @flow strict-local

import type {
  AST,
  BaseAsset,
  PluginOptions,
  SourceLocation,
  FilePath,
} from '@parcel/types';
import type {
  SourceLocation as BabelSourceLocation,
  File as BabelNodeFile,
} from '@babel/types';

import path from 'path';
import {parse as babelParse} from '@babel/parser';
import SourceMap from '@parcel/source-map';
import {relativeUrl} from '@parcel/utils';
import {babelErrorEnhancer} from './babelErrorUtils';
// $FlowFixMe
import {generate as astringGenerate} from 'astring';
// $FlowFixMe
import {generator, expressionsPrecedence} from './generator';

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
      }),
    };
  } catch (e) {
    throw await babelErrorEnhancer(e, asset);
  }
}

// astring is ~50x faster than @babel/generator. We use it with a custom
// generator to handle the Babel AST differences from ESTree.
export function generateAST({
  ast,
  sourceFileName,
  sourceMaps,
  originalSourceMap,
  options,
}: {|
  ast: BabelNodeFile,
  sourceFileName?: FilePath,
  sourceMaps?: boolean,
  originalSourceMap?: ?SourceMap,
  options: PluginOptions,
|}): {|content: string, map: ?SourceMap|} {
  let map = new SourceMap(options.projectRoot);
  let mappings = [];
  let generated = astringGenerate(ast.program, {
    generator,
    expressionsPrecedence,
    comments: true,
    sourceMap: sourceMaps
      ? {
          file: sourceFileName,
          addMapping(mapping) {
            // Copy the object because astring mutates it
            mappings.push({
              original: mapping.original,
              generated: {
                line: mapping.generated.line,
                column: mapping.generated.column,
              },
              name: mapping.name,
              source: mapping.source,
            });
          },
        }
      : null,
  });

  map.addIndexedMappings(mappings);

  if (originalSourceMap) {
    map.extends(originalSourceMap.toBuffer());
  }

  return {
    content: generated,
    map,
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
|}): Promise<{|content: string, map: ?SourceMap|}> {
  let sourceFileName: string = relativeUrl(options.projectRoot, asset.filePath);
  return generateAST({
    ast: ast.program,
    sourceFileName,
    sourceMaps: !!asset.env.sourceMap,
    originalSourceMap: await asset.getMap(),
    options,
  });
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
