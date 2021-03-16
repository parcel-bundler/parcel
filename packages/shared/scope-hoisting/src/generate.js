// @flow

import type {NamedBundle, PluginOptions} from '@parcel/types';
import type {File} from '@babel/types';

import invariant from 'assert';
import {generateAST} from '@parcel/babel-ast-utils';
import SourceMap from '@parcel/source-map';
import * as t from '@babel/types';

export function generate({
  bundle,
  ast,
  options,
}: {|
  bundle: NamedBundle,
  ast: File,
  options: PluginOptions,
|}): {|contents: string, map: ?SourceMap|} {
  let interpreter;
  let mainEntry = bundle.getMainEntry();
  if (mainEntry && !bundle.target.env.isBrowser()) {
    let _interpreter = mainEntry.meta.interpreter;
    invariant(_interpreter == null || typeof _interpreter === 'string');
    interpreter = _interpreter;
  }

  ast = t.file(
    t.program(
      ast.program.body,
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
