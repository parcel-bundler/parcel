// @flow

import type {AST, Bundle, BundleGraph, PluginOptions} from '@parcel/types';
import babelGenerate from '@babel/generator';
import nullthrows from 'nullthrows';

export function generate(
  bundleGraph: BundleGraph,
  bundle: Bundle,
  ast: AST,
  options: PluginOptions
) {
  let {code} = babelGenerate(ast, {
    minified: options.minify,
    comments: !options.minify
  });

  // $FlowFixMe
  let interpreter: ?string = bundle.target.env.isBrowser()
    ? null
    : nullthrows(bundle.getMainEntry()).meta.interpreter;
  let hashBang = interpreter != null ? `#!${interpreter}\n` : '';

  let entry = bundle.getMainEntry();
  let isAsync = bundleGraph.hasParentBundleOfType(bundle, 'js') && entry;
  if (!options.minify && (isAsync || !bundle.env.isModule)) {
    code = `\n${code}\n`;
  }

  // Wrap async bundles in a closure and register with parcelRequire so they are executed
  // at the right time (after other bundle dependencies are loaded).
  let contents = '';
  if (isAsync && !bundle.env.isModule) {
    contents = `${hashBang}parcelRequire.registerBundle(${JSON.stringify(
      nullthrows(entry).id
    )},function(){${code}});`;
  } else {
    contents = bundle.env.isModule
      ? hashBang + code
      : `${hashBang}(function(){${code}})();`;
  }

  return {contents};
}
