// @flow

import type {MutableAsset, AST, PluginOptions} from '@parcel/types';

import invariant from 'assert';
import * as babel from '@babel/core';
import {relativeUrl} from '@parcel/utils';
import traverse from '@babel/traverse';

import packageJson from '../package.json';

const transformerVersion: mixed = packageJson.version;
invariant(typeof transformerVersion === 'string');

type Babel7TransformOptions = {|
  asset: MutableAsset,
  options: PluginOptions,
  babelOptions: any,
  additionalPlugins?: Array<any>,
|};

export default async function babel7(
  opts: Babel7TransformOptions,
): Promise<?AST> {
  let {asset, options, babelOptions, additionalPlugins = []} = opts;

  let config = {
    ...babelOptions.config,
    plugins: additionalPlugins.concat(babelOptions.config.plugins),
    code: false,
    ast: true,
    filename: asset.filePath,
    babelrc: false,
    configFile: false,
    parserOpts: {
      ...babelOptions.config.parserOpts,
      sourceFilename: relativeUrl(options.projectRoot, asset.filePath),
      allowReturnOutsideFunction: true,
      strictMode: false,
      sourceType: 'module',
    },
    caller: {
      name: 'parcel',
      version: transformerVersion,
      targets: JSON.stringify(babelOptions.targets),
      outputFormat: asset.env.outputFormat,
    },
  };

  let ast = await asset.getAST();
  let res;
  if (ast) {
    res = await babel.transformFromAstAsync(
      ast.program,
      asset.isASTDirty() ? undefined : await asset.getCode(),
      config,
    );
  } else {
    res = await babel.transformAsync(await asset.getCode(), config);
    if (res.ast) {
      let map = await asset.getMap();
      if (map) {
        // remap ast to original mappings
        // This improves sourcemap accuracy and fixes sourcemaps when scope-hoisting
        traverse(res.ast.program, {
          enter(path) {
            if (path.node.loc) {
              if (path.node.loc?.start) {
                // TODO: Check if babel ast uses 1 or zero based indexes and match to our indexing system...
                let mapping = map.findClosestMapping(
                  path.node.loc.start.line,
                  path.node.loc.start.column,
                );

                if (mapping?.original) {
                  // $FlowFixMe
                  path.node.loc.start.line = mapping.original.line;
                  // $FlowFixMe
                  path.node.loc.start.column = mapping.original.column;

                  if (path.node.loc?.end) {
                    // $FlowFixMe
                    path.node.loc.end.line = mapping.original.line;
                    // $FlowFixMe
                    path.node.loc.end.column = mapping.original.column;
                  }

                  // $FlowFixMe
                  path.node.loc.filename = mapping.source;
                } else {
                  console.log('No original mapping for:', path.node.loc.start);
                }
              }
            }
          },
        });
      }
    }
  }

  if (res.ast) {
    asset.setAST({
      type: 'babel',
      version: '7.0.0',
      program: res.ast,
    });
  }
}
