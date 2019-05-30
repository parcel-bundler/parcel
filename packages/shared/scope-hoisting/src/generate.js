// @flow

import type {AST, Bundle, ParcelOptions} from '@parcel/types';
import babelGenerate from '@babel/generator';

export function generate(bundle: Bundle, ast: AST, options: ParcelOptions) {
  let {code} = babelGenerate(ast, {
    minified: options.minify,
    comments: !options.minify
  });

  if (!options.minify) {
    code = `\n${code}\n`;
  }

  let entryAsset = bundle.getEntryAssets()[0];
  // $FlowFixMe
  let interpreter: ?string = entryAsset.meta.interpreter;
  return {
    contents: `${
      interpreter != null ? `#!${interpreter}\n` : ''
    }(function(){${code}})();`
  };
}
