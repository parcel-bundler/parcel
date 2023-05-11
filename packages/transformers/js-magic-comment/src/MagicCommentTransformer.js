// @flow strict-local

import {Transformer} from '@parcel/plugin';
import jsTokens, {type Token, type JSXToken} from 'js-tokens';
import nullthrows from 'nullthrows';

export default (new Transformer({
  async transform({asset}) {
    let code = await asset.getCode();
    if (code.includes('webpackChunkName')) {
      let imports = getDynamicImports(code);
      for (let {specifier, comment} of imports) {
        asset.addDependency({
          specifier,
          specifierType: 'esm',
          priority: 'lazy',
          meta: {
            chunkNameMagicComment: comment,
          },
          // conservative
          isOptional: true,
        });
      }
    }
    return [asset];
  },
}): Transformer);

const CHUNK_NAME_REGEX = /webpackChunkName: (".*"|'.*')/;

function getDynamicImports(code) {
  let tokens = jsTokens(code, {jsx: true});

  let result = tokens.next();
  let token: Token | JSXToken = nullthrows(result.value);
  let imports = [];

  function consumeWhile(pred: (Token | JSXToken) => boolean) {
    if (token && pred(token)) {
      result = tokens.next();
      while (!result.done && pred(result.value)) {
        result = tokens.next();
      }
      token = nullthrows(result.value);
    }
  }
  function consumeWhitespace() {
    consumeWhile(
      t => t.type === 'WhiteSpace' || t.type === 'LineTerminatorSequence',
    );
  }

  function consume() {
    result = tokens.next();
    token = nullthrows(result.value);
  }

  while (!result.done) {
    if (token.type === 'IdentifierName' && token.value === 'import') {
      consume(); // import
      consumeWhitespace();
      if (token.type === 'Punctuator' && token.value == '(') {
        consume(); // (
        consumeWhitespace();
        let comment;
        while (token.type === 'MultiLineComment') {
          comment ??= token.value.slice(2, -2).match(CHUNK_NAME_REGEX);
          consume(); // the comment
          consumeWhitespace();
        }
        if (comment != null && token.type === 'StringLiteral') {
          imports.push({
            specifier: token.value.slice(1, -1),
            comment: comment[1].slice(1, -1),
          });
          consume(); // the StringLiteral
        }
        continue;
      }
    }

    result = tokens.next();
    if (result.value == null) {
      break;
    } else {
      token = result.value;
    }
  }

  return imports;
}
