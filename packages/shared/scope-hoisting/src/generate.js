// @flow

import type {AST, Bundle, PluginOptions} from '@parcel/types';
import babelGenerate from '@babel/generator';
import nullthrows from 'nullthrows';

export function generate(bundle: Bundle, ast: AST, options: PluginOptions) {
  let {code} = babelGenerate(ast, {
    minified: options.minify,
    comments: !options.minify
  });

  if (!options.minify) {
    code = `\n${code}\n`;
  }

  // $FlowFixMe
  let interpreter: ?string = bundle.target.env.isBrowser()
    ? null
    : nullthrows(bundle.getMainEntry()).meta.interpreter;
  return {
    contents: `${
      interpreter != null ? `#!${interpreter}\n` : ''
    }(function(){${code}})();`
  };
}
