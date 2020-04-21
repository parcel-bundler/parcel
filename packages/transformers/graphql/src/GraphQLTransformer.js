// @flow
import {Transformer} from '@parcel/plugin';

import {parse, print, Source} from 'graphql/language';
import {stripIgnoredCharacters} from 'graphql/utilities';
import {processDocumentImports} from 'graphql-import-macro';

export default new Transformer({
  getConfig({options}) {
    return Promise.resolve({
      stripIgnoredCharacters: options.mode === 'production',
    });
  },

  async transform({asset, options, resolve, config}) {
    const document = parse(new Source(await asset.getCode(), asset.filePath));

    const expandedDocument = await processDocumentImports(document, loadImport);

    const generated =
      config && config.stripIgnoredCharacters
        ? stripIgnoredCharacters(print(expandedDocument))
        : print(expandedDocument);

    asset.type = 'js';
    asset.setCode(`module.exports=${JSON.stringify(generated)};`);

    return [asset];

    async function loadImport(to, from) {
      const filePath = await resolve(to, from);

      asset.addIncludedFile({filePath});

      return parse(
        new Source(await options.inputFS.readFile(filePath, 'utf-8'), filePath),
      );
    }
  },
});
