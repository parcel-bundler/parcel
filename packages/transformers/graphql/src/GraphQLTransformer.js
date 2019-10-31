// @flow
import {Transformer} from '@parcel/plugin';

const IMPORT_RE = /^# *import +['"](.*)['"] *;? *$/;
const NEWLINE = /\r\n|[\n\r\u2028\u2029]/;

export default new Transformer({
  async transform({asset, options, resolve}) {
    // Peer dependency of graphql-tag
    await options.packageManager.resolve('graphql', asset.filePath);

    let gql = await options.packageManager.require(
      'graphql-tag',
      asset.filePath
    );

    let gqlMap = new Map();
    const traverseImports = (name: string, assetCode: string) => {
      gqlMap.set(name, assetCode);

      return Promise.all(
        assetCode
          .split(NEWLINE)
          .map(line => line.match(IMPORT_RE))
          .filter(match => !!match)
          // $FlowFixMe
          .map(async ([, importName]) => {
            let resolved = await resolve(name, importName);

            if (gqlMap.has(resolved)) {
              return;
            }

            let code = await options.inputFS.readFile(resolved, 'utf8');
            asset.addIncludedFile({
              filePath: resolved
            });

            await traverseImports(resolved, code);
          })
      );
    };

    await traverseImports(asset.filePath, await asset.getCode());

    asset.type = 'js';
    asset.setCode(
      `module.exports=${JSON.stringify(
        gql([...gqlMap.values()].join('\n')),
        null,
        2
      )};`
    );

    return [asset];
  }
});
