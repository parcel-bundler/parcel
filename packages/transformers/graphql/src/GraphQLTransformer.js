// @flow
import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async transform({asset, options, resolve}) {
    const {
      parse,
      print,
      Source,
      stripIgnoredCharacters,
    } = await options.packageManager.require('graphql', asset.filePath, {
      shouldAutoInstall: options.shouldAutoInstall,
    });

    const {processDocumentImports} = await options.packageManager.require(
      'graphql-import-macro',
      asset.filePath,
      {
        shouldAutoInstall: options.shouldAutoInstall,
      },
    );

    const document = parse(new Source(await asset.getCode(), asset.filePath));

    const expandedDocument = await processDocumentImports(document, loadImport);

    async function loadImport(to, from) {
      const filePath = await resolve(to, from);

      asset.addIncludedFile(filePath);

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
