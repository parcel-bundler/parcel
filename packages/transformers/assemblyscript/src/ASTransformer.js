// @flow strict-local

import {Transformer} from '@parcel/plugin';
import * as Parcel from '@parcel/types';
import {promises as fsp} from 'fs';
import * as path from 'path';
import {tmpdir} from 'os';

const MARKER = 'asc:';
const PREFIX_MATCHER = /^asc:(.+)$/;
const defaultOpts = {
  matcher: PREFIX_MATCHER,
  compilerOptions: {},
  useAsBind: false,
};

// This special import contains the `compileStreaming` polyfill.
const SPECIAL_IMPORT = '__parcel-plugin-assemblyscript_compileStreaming';

type ASTransformerOptions = Parcel.PluginOptions & {
  matcher: string,
  compilerOptions: {},
  useAsBind: boolean,
  ...
};

export default (new Transformer({
  // eslint-disable-next-line no-unused-vars
  async transform(transformArgs: {
    asset: Parcel.Asset,
    options: Parcel.PluginOptions,
  }) {
    let {asset, options} = transformArgs;
    const specialImport = asset.meta.specialImport;

    const opts: ASTransformerOptions = {...defaultOpts, ...options};

    const asCompiler = await opts.packageManager.require(
      'assemblyscript/cli/asc',
      asset.filePath,
      {
        shouldAutoInstall: opts.shouldAutoInstall,
      },
    );

    const wasmFileName = `${path.basename(asset.filePath)}.wasm`;
    const folder = tmpdir();
    const wasmFilePath = path.join(folder, wasmFileName);
    const sourceMapFileName = wasmFileName + '.map';
    const sourceMapFilePath = path.join(folder, sourceMapFileName);
    await asCompiler.ready;

    if (specialImport === SPECIAL_IMPORT) {
      return `
        export async function compileStreaming(respP) {
          if('compileStreaming' in WebAssembly) {
            return WebAssembly.compileStreaming(respP);
          }
          return respP
            .then(resp => resp.arrayBuffer())
            .then(buffer => WebAssembly.compile(buffer));
        }
      `;
    }
    if (!specialImport.startsWith(MARKER)) {
      return;
    }

    await new Promise((resolve, reject) => {
      const params = [
        opts.useAsBind
          ? [
              require.resolve('as-bind/lib/assembly/as-bind.ts'),
              '--exportRuntime',
            ]
          : [],
        specialImport,
        '-b',
        wasmFilePath,
        ...Object.entries(opts.compilerOptions).map(([opt, val]) => {
          if (val === true) {
            return `--${opt}`;
          }
          return `--${opt}=${val}`;
        }),
        opts.fileExtension ? [`--extension`, opts.fileExtension] : [],
      ].flat();
      asCompiler.main(params, err => {
        if (err) {
          return reject(`${err}`);
        }
        resolve();
      });
    });

    // wasm file
    asset.type = 'wasm';
    asset.setCode(await fsp.readFile(wasmFilePath));
    if (opts.sourceMapURLPattern) {
      asset.setMap(await fsp.readFile(sourceMapFilePath));
    }

    // wasm wrapper for browser (TODO support Nodejs)
    const wasmWrapper = {
      type: 'js',
      // TODO port Rollup imports
      code: `
        import {compileStreaming} from "${SPECIAL_IMPORT}";
        export const wasmUrl = import.meta.PARCEL_FILE_URL_${asset.uniqueKey};
        export default wasmUrl;
        `,
    };

    return [asset, wasmWrapper];
  },
}): Transformer);
