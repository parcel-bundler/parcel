// @flow

import {dirname} from 'path';

import {Transformer} from '@parcel/plugin';

import {spawnProcess} from './helpers';

export default (new Transformer({
  async transform({asset, options}) {
    await options.packageManager.require('wasm-pack', asset.filePath, {
      autoinstall: options.autoinstall,
    });

    const args = [
      '--verbose',
      'build',
      ...(options.mode === 'production' ? ['--release'] : ['--dev']),
      /**
       * valid ParcelJS targets are browser, electron, and node
       * @see: https://parceljs.org/cli.html#target
       *
       * valid wasm-pack targets are bundler, web, nodejs, and no-modules
       * @see: https://rustwasm.github.io/docs/wasm-bindgen/reference/deployment.html#deploying-rust-and-webassembly
       */
      '--target',
      'bundler',
    ];

    const stdout = await spawnProcess('wasm-pack', args, {
      cwd: dirname(asset.filePath),
    });
    console.log(stdout);

    return [asset];
  },
}): Transformer);
