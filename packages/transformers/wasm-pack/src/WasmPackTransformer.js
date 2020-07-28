// @flow

import {exec} from 'child_process';
import {promisify} from 'util';
import {dirname} from 'path';

import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async transform({asset, options}) {
    await options.packageManager.require('wasm-pack', asset.filePath, {
      autoinstall: options.autoinstall,
    });

    const args = [
      '--verbose',
      'build',
      ...(options.mode === 'production' ? ['--release'] : ['--dev']),
      '--target',
      /**
       * valid ParcelJS targets are browser, electron, and node
       * @see: https://parceljs.org/cli.html#target
       *
       * valid wasm-pack targets are bundler, web, nodejs, and no-modules
       * @see: https://rustwasm.github.io/docs/wasm-bindgen/reference/deployment.html#deploying-rust-and-webassembly
       */
      'bundler',
    ];

    console.log(`wasm-pack ${args.join(' ')}`);
    await promisify(exec)(`wasm-pack ${args.join(' ')}`, {
      cwd: dirname(asset.filePath),
    });

    return [asset];
  },
}): Transformer);
