// @flow

import type {AST, Bundle, BundleGraph, PluginOptions} from '@parcel/types';
import babelGenerate from '@babel/generator';
import nullthrows from 'nullthrows';
import {isEntry} from './utils';

export function generate(
  bundleGraph: BundleGraph,
  bundle: Bundle,
  ast: AST,
  options: PluginOptions
) {
  let {code} = babelGenerate(ast, {
    minified: options.minify,
    comments: true // retain /*@__PURE__*/ comments for terser
  });

  // $FlowFixMe
  let interpreter: ?string = bundle.target.env.isBrowser()
    ? null
    : nullthrows(bundle.getMainEntry()).meta.interpreter;
  let hashBang = interpreter != null ? `#!${interpreter}\n` : '';

  let entry = bundle.getMainEntry();
  let isAsync = entry && !isEntry(bundle, bundleGraph);
  if (!options.minify && (isAsync || bundle.env.outputFormat === 'global')) {
    code = `\n${code}`;
  }

  // Wrap async bundles in a closure and register with parcelRequire so they are executed
  // at the right time (after other bundle dependencies are loaded).
  let contents = '';
  if (isAsync && bundle.env.outputFormat === 'global') {
    contents = `${hashBang}parcelRequire.registerBundle(${JSON.stringify(
      nullthrows(entry).id
    )},function(){${code}\n});`;
  } else {
    contents =
      hashBang +
      (bundle.env.outputFormat === 'global'
        ? `(function(){${code}\n})();`
        : code);
  }

  return {contents};
}
