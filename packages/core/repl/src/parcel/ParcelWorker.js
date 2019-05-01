if (!self.Buffer) {
  self.Buffer = require('buffer').Buffer;
}

const Comlink = require('comlink');
import {hasBrowserslist} from '../utils';
import path from 'path';
import fastGlob from 'fast-glob';

import process from 'process';

import fs from '@parcel/fs';
import prettyError from '@parcel/logger/src/prettyError';
import fsNative from 'fs';
import Bundler from 'parcel-bundler';

self.process = process;
self.fs = fsNative;

export async function bundle(assets, options) {
  // if (fsNative.data.src) delete fsNative.data.src;
  // if (fsNative.data.dist) delete fsNative.data.dist;
  fsNative.data = {};
  process.env = {};

  await fs.mkdirp('/src/');

  if (options.browserslist && !hasBrowserslist(assets)) {
    await fs.writeFile(`/src/.browserslistrc`, options.browserslist);
  }

  for (let f of assets) {
    const p = `/src/${f.name}`;
    fsNative.mkdirpSync(path.dirname(p));
    await fs.writeFile(p, f.content || ' ');
  }

  const entryPoints = assets.filter(v => v.isEntry).map(v => `/src/${v.name}`);

  if (!entryPoints.length) throw new Error('No asset marked as entrypoint');

  let entryPointsOutput;
  try {
    const bundler = new Bundler(entryPoints, {
      outDir: '/dist',
      autoinstall: false,
      watch: false,
      cache: true,
      hmr: false,
      logLevel: 0,
      minify: options.minify,
      scopeHoist: options.scopeHoist,
      sourceMaps: options.sourceMaps,
      publicUrl: options.publicUrl,
      global: options.global,
      contentHash: options.contentHash,
      target: options.target
    });
    const bundle = await bundler.bundle();

    const entryPointsOutputBundles = bundle.name
      ? [bundle]
      : [...bundle.childBundles];
    entryPointsOutput = new Set(entryPointsOutputBundles.map(v => v.name));
  } catch (e) {
    let result = '';

    const {message, stack} = prettyError(e, {color: true});
    result += message + '\n';
    if (stack) {
      result += stack + '\n';
    }
    throw new Error(result);
  }

  const output = [];

  for (let f of await fastGlob('/dist/**/*')) {
    output.push({
      name: f.replace(/^\/dist\//, ''),
      content: await fs.readFile(f, 'utf8'),
      isEntry: entryPointsOutput.has(f)
    });
  }
  return output;
}

class ParcelWorker {
  async bundle(assets, options) {
    return bundle(assets, options);
  }

  getFS() {
    return fsNative.data;
  }
}

Comlink.expose(ParcelWorker, self);
