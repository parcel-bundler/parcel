// @flow strict-local

import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  transform({asset}) {
    asset.type = 'js';
    asset.setCode(`
    	export function parser(){return 1;}
    	export * from "terms";
    `);
    asset.addDependency({
      specifier: 'terms',
      specifierType: 'esm',
    });
    return [
      asset,
      //       {
      //         type: 'js',
      //         content: `
      //         export function parser(){return 1;}
      // export * from "terms";`,
      //         dependencies: [
      //           {
      //             specifier: 'terms',
      //             specifierType: 'esm',
      //           },
      //         ],
      //       },
      {
        type: 'js',
        uniqueKey: 'terms',
        content: `export const A = "A", B = "B";`,
      },
    ];
  },
}): Transformer);
