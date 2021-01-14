// @flow

import type {
  Asset,
  BundleGraph,
  NamedBundle,
  PluginOptions,
} from '@parcel/types';
import type {
  ArrayExpression,
  ExpressionStatement,
  Identifier,
  File,
  Statement,
} from '@babel/types';

import {generateAST} from '@parcel/babel-ast-utils';
import invariant from 'assert';
import {isEntry} from './utils';
import SourceMap from '@parcel/source-map';
import * as t from '@babel/types';
import template from '@babel/template';

const REGISTER_TEMPLATE = template.statement<
  {|
    REFERENCED_IDS: ArrayExpression,
    STATEMENTS: Array<Statement>,
    PARCEL_REQUIRE: Identifier,
  |},
  ExpressionStatement,
>(`(function() {
  function $parcel$bundleWrapper() {
    if ($parcel$bundleWrapper._executed) return;
    $parcel$bundleWrapper._executed = true;
    STATEMENTS;
  }
  var $parcel$referencedAssets = REFERENCED_IDS;
  for (var $parcel$i = 0; $parcel$i < $parcel$referencedAssets.length; $parcel$i++) {
    PARCEL_REQUIRE.registerBundle($parcel$referencedAssets[$parcel$i], $parcel$bundleWrapper);
  }
})()`);
const WRAPPER_TEMPLATE = template.statement<
  {|STATEMENTS: Array<Statement>|},
  ExpressionStatement,
>('(function () { STATEMENTS; })()');

export function generate({
  bundleGraph,
  bundle,
  ast,
  referencedAssets,
  parcelRequireName,
  options,
}: {|
  bundleGraph: BundleGraph<NamedBundle>,
  bundle: NamedBundle,
  ast: File,
  options: PluginOptions,
  referencedAssets: Set<Asset>,
  parcelRequireName: string,
|}): {|contents: string, map: ?SourceMap|} {
  let interpreter;
  let mainEntry = bundle.getMainEntry();
  if (mainEntry && !bundle.target.env.isBrowser()) {
    let _interpreter = mainEntry.meta.interpreter;
    invariant(_interpreter == null || typeof _interpreter === 'string');
    interpreter = _interpreter;
  }

  let isAsync = !isEntry(bundle, bundleGraph);

  // Wrap async bundles in a closure and register with parcelRequire so they are executed
  // at the right time (after other bundle dependencies are loaded).
  let statements = ast.program.body;
  if (bundle.env.outputFormat === 'global') {
    statements = isAsync
      ? [
          REGISTER_TEMPLATE({
            STATEMENTS: statements,
            REFERENCED_IDS: t.arrayExpression(
              [mainEntry, ...referencedAssets]
                .filter(Boolean)
                .map(asset =>
                  t.stringLiteral(bundleGraph.getAssetPublicId(asset)),
                ),
            ),
            PARCEL_REQUIRE: t.identifier(parcelRequireName),
          }),
        ]
      : [WRAPPER_TEMPLATE({STATEMENTS: statements})];
  }

  ast = t.file(
    t.program(
      statements,
      [],
      bundle.env.outputFormat === 'esmodule' ? 'module' : 'script',
      interpreter ? t.interpreterDirective(interpreter) : null,
    ),
  );

  let {content, map} = generateAST({
    ast,
    sourceMaps: !!bundle.env.sourceMap,
    options,
  });

  return {
    contents: content,
    map,
  };
}
