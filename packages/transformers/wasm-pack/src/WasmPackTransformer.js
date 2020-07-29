// @flow

import {dirname, join} from 'path';

import {Transformer} from '@parcel/plugin';

import {spawnProcess} from './helpers';

export default (new Transformer({
  async transform({asset, options}) {
    // need to parse the `Cargo.toml` to get the name out of it, `wasm-pack`
    // will use this name + `_bg.{js,wasm}` for code gen
    const toml = await options.packageManager.require(
      '@iarna/toml',
      asset.filePath,
      {autoinstall: options.autoinstall},
    );

    // the `wasm-pack` module handles all the env setup stuff for us now, yay!
    await options.packageManager.require('wasm-pack', asset.filePath, {
      autoinstall: options.autoinstall,
    });

    const args = [
      /**
       * not 100% sure why but `--verbose` has to go first, and I want to show
       * all the `wasm-pack` progress in Parcel's `logger.progress`
       */
      '--verbose',
      /**
       * we're only using `wasm-pack`'s build command
       * @see https://rustwasm.github.io/wasm-pack/book/commands/build.html
       */
      'build',
      /**
       * valid ParcelJS targets are browser, electron, and node
       * @see https://parceljs.org/cli.html#target
       *
       * valid wasm-pack targets are bundler, web, nodejs, and no-modules
       * @see https://rustwasm.github.io/docs/wasm-bindgen/reference/deployment.html#deploying-rust-and-webassembly
       */
      '--target',
      'bundler',
      /**
       * there's also `--profiling` but I'm not sure how to pass an arg
       * "through" Parcel like that
       * @see https://rustwasm.github.io/wasm-pack/book/commands/build.html#profile
       */
      ...(options.mode === 'production' ? ['--release'] : ['--dev']),
    ];

    const fileDir = dirname(asset.filePath);
    await spawnProcess('wasm-pack', args, {
      /**
       * run `wasm-pack --verbose build --target bundler --{release,dev}` from
       * the directory where the `Cargo.toml` asset lives
       */
      cwd: fileDir,
    });

    // get the name of the Rust package (crate?) from the `Cargo.toml`
    const {
      package: {name},
    } = toml.parse(await asset.getCode());

    // `wasm-pack` creates a `pkg` dir with the code it generates
    const pkgPath = join(fileDir, 'pkg');

    // we're really only interested in the js "glue" code, and the wasm itself
    const jsPath = join(pkgPath, `${name}_bg.js`);
    const wasmPath = join(pkgPath, `${name}_bg.wasm`);

    // let's just make sure they actually exist before we go any further
    const jsExists = await options.inputFS.exists(jsPath);
    const wasmExists = await options.inputFS.exists(wasmPath);

    if (!(jsExists && wasmExists)) {
      const messages = [
        ...(!jsExists ? [`"${jsPath}"`] : []),
        ...(!wasmExists ? [`"${wasmPath}"`] : []),
      ];

      throw new Error(
        `Expected ${messages.join(' and ')} but ${
          messages.length > 1 ? "they don't" : "it doesn't"
        } exist`,
      );
    }

    // loader
    // initializer
    // bundler?

    return [asset];
  },
}): Transformer);
