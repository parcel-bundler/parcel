// @flow
import type {Bundle, ParcelOptions} from '@parcel/types';
import babelGenerate from '@babel/generator';

export function generate(bundle: Bundle, ast, options: ParcelOptions) {
  let {code} = babelGenerate(ast, {
    minified: options.minify,
    comments: !options.minify
  });

  if (!options.minify) {
    code = `\n${code}\n`;
  }

  return `(function(){${code}})();`;
}
