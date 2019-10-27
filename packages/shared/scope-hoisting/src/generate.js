// @flow

import type {AST, Bundle, BundleGraph, PluginOptions} from '@parcel/types';
import babelGenerate from '@babel/generator';
import nullthrows from 'nullthrows';
import {isEntry} from './utils';
import SourceMap from '@parcel/source-map';
import * as t from '@babel/types';
import template from '@babel/template';

const REGISTER_TEMPLATE = template(
  'parcelRequire.registerBundle(ID, function () { STATEMENTS; })'
);
const WRAPPER_TEMPLATE = template('(function () { STATEMENTS; })()');

export function generate(
  bundleGraph: BundleGraph,
  bundle: Bundle,
  ast: AST,
  options: PluginOptions
) {
  // $FlowFixMe
  let interpreter: ?string = bundle.target.env.isBrowser()
    ? null
    : nullthrows(bundle.getMainEntry()).meta.interpreter;

  let entry = bundle.getMainEntry();
  let isAsync = entry && !isEntry(bundle, bundleGraph);

  // Wrap async bundles in a closure and register with parcelRequire so they are executed
  // at the right time (after other bundle dependencies are loaded).
  let statements = ast.program.body;
  if (isAsync && bundle.env.outputFormat === 'global') {
    statements = [
      REGISTER_TEMPLATE({
        ID: t.stringLiteral(nullthrows(entry).id),
        STATEMENTS: statements
      })
    ];
  } else if (bundle.env.outputFormat === 'global') {
    statements = [WRAPPER_TEMPLATE({STATEMENTS: statements})];
  }

  ast = t.file(
    t.program(
      statements,
      [],
      bundle.env.outputFormat === 'esmodule' ? 'module' : 'script',
      interpreter ? t.interpreterDirective(interpreter) : null
    )
  );

  let {code, rawMappings} = babelGenerate(ast, {
    sourceMaps: options.sourceMaps,
    minified: options.minify,
    comments: true // retain /*@__PURE__*/ comments for terser
  });

  return {
    contents: code,
    map: options.sourceMaps ? new SourceMap(rawMappings) : null
  };
}
