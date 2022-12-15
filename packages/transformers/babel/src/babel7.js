// @flow

import type {MutableAsset, AST, PluginOptions} from '@parcel/types';
import typeof * as BabelCore from '@babel/core';

import invariant from 'assert';
import {relativeUrl} from '@parcel/utils';
import {remapAstLocations} from './remapAstLocations';

import packageJson from '../package.json';
import {applicationProfiler} from '@parcel/profiler';
import path from 'path';

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
  const babelCore: BabelCore = await options.packageManager.require(
    '@babel/core',
    asset.filePath,
    {
      range: '^7.12.0',
      saveDev: true,
      shouldAutoInstall: options.shouldAutoInstall,
    },
  );

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
      plugins: [
        ...(babelOptions.config.parserOpts?.plugins ?? []),
        ...(babelOptions.syntaxPlugins ?? []),
        // Applied by preset-env
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'exportDefaultFrom',
        // 'topLevelAwait'
      ],
    },
    caller: {
      name: 'parcel',
      version: transformerVersion,
      targets: JSON.stringify(babelOptions.targets),
      outputFormat: asset.env.outputFormat,
    },
  };

  if (applicationProfiler.enabled) {
    config.wrapPluginVisitorMethod = (
      key: string,
      nodeType: string,
      fn: Function,
    ) => {
      return function () {
        const measurement = applicationProfiler.createMeasurement(
          `babel:${key}`,
          {
            categories: ['transform:babel'],
            args: {
              name: path.relative(options.projectRoot, asset.filePath),
              nodeType,
            },
          },
        );
        fn.apply(this, arguments);
        measurement.end();
      };
    };
  }

  let ast = await asset.getAST();
  let res;
  if (ast) {
    res = await babelCore.transformFromAstAsync(
      ast.program,
      asset.isASTDirty() ? undefined : await asset.getCode(),
      config,
    );
  } else {
    res = await babelCore.transformAsync(await asset.getCode(), config);
    if (res.ast) {
      let map = await asset.getMap();
      if (map) {
        remapAstLocations(babelCore.types, res.ast, map);
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
