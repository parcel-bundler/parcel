// @flow

import {Transformer} from '@parcel/plugin';
import {JSDOM} from 'jsdom';
import nullthrows from 'nullthrows';
import semver from 'semver';

export default (new Transformer({
  canReuseAST({ast}) {
    return ast.type === 'jsdom' && semver.satisfies(ast.version, '^16.6.0');
  },

  async parse({asset}) {
    return {
      type: 'jsdom',
      version: '16.6.0',
      program: new JSDOM(await asset.getBuffer(), {
        contentType: 'application/xml',
      }),
    };
  },

  async transform({asset}) {
    const ast = nullthrows(await asset.getAST());
    const window = ast.program.window;
    const document = window.document;
    let isDirty = false;

    const walker = document.createTreeWalker(
      document,
      window.NodeFilter.SHOW_PROCESSING_INSTRUCTION,
      node =>
        node.target === 'xml-stylesheet'
          ? window.NodeFilter.FILTER_ACCEPT
          : window.NodeFilter.FILTER_SKIP,
    );

    while (walker.nextNode()) {
      const node = walker.currentNode;

      node.data = node.data.replace(
        /(?<=(?:^|\s)href\s*=\s*")(.+?)(?=")/i,
        href => {
          isDirty = true;

          return asset.addURLDependency(href, {priority: 'parallel'});
        },
      );
    }

    if (isDirty) {
      asset.setAST(ast);
    }

    return [asset];
  },

  generate({ast}) {
    return {
      content: ast.program.serialize(),
    };
  },
}): Transformer);
