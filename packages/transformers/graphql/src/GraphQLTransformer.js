// @flow
import type {FilePath} from '@parcel/types';

import {Transformer} from '@parcel/plugin';
import {parse, print, Source, stripIgnoredCharacters} from 'graphql';
import {processDocumentImports} from 'graphql-import-macro';

export default (new Transformer({
  async transform({asset, options, resolve}) {
    const document = parse(new Source(await asset.getCode(), asset.filePath));
    const expandedDocument = await processDocumentImports(document, loadImport);

    async function loadImport(to: FilePath, from: FilePath) {
      const filePath = await resolve(to, from);

      asset.invalidateOnFileChange(filePath);

      return parse(
        new Source(await options.inputFS.readFile(filePath, 'utf-8'), filePath),
      );
    }

    const generated = asset.env.shouldOptimize
      ? stripIgnoredCharacters(print(expandedDocument))
      : print(expandedDocument);

    asset.type = 'js';
    asset.setCode(`module.exports=${JSON.stringify(generated)};`);

    return [asset];
  },
}): Transformer);
