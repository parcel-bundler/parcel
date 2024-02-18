// @flow

import {Transformer} from '@parcel/plugin';
import nullthrows from 'nullthrows';

export default (new Transformer({
  async transform({asset}) {
    if (asset.isSource) {
      if (asset.env.isNode()) {
        let client = await asset.getCode();
        if (client.includes('"use client";')) {
          let server = '';
          let symbols = new Map();
          for (let symbol of asset.symbols.exportSymbols()) {
            let {local, loc} = nullthrows(asset.symbols.get(symbol));
            server += `function ${local}() {}\n`;
            server += `Object.defineProperties(${local}, {
              $$typeof: {value:  Symbol.for('react.client.reference')},
              id: {value: ${JSON.stringify(asset.filePath)}},
              name: {value: ${JSON.stringify(symbol)}},
            });\n`;
            symbols.set(symbol, {local, loc});
          }

          let dependencies = asset.getDependencies();
          asset.removeAllDependencies();

          asset.setCode(server);

          return [
            asset,
            {
              type: 'js',
              content: client,
              uniqueKey: 'client',
              dependencies: dependencies.map(dep => ({
                specifier: dep.specifier,
                specifierType: dep.specifierType,
                priority: dep.priority,
                meta: dep.meta,
                symbols: new Map([...dep.symbols.exportSymbols()].map(d => [d, dep.symbols.get(d)]))
              })),
              symbols,
              env: {
                context: 'browser',
                outputFormat: 'esmodule',
                includeNodeModules: true
              },
              meta: {
                isClientComponent: true
              }
            }
          ];
        }
      }
    }

    return [asset];
  },
}): Transformer);
