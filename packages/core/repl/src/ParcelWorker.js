const Comlink = require('comlink');
import {hasBrowserslist} from './utils';

import fs from '@parcel/fs';
import fsNative from 'fs';
self.fs = fsNative;
import Bundler from 'parcel-bundler';

export async function bundle(assets, options) {
  fsNative.data = {};

  await fs.mkdirp('/src/');

  if (options.browserslist) {
    if (!hasBrowserslist(assets)) {
      await fs.writeFile(`/src/.browserslistrc`, options.browserslist);
    }
  }

  for (let f of assets) {
    await fs.writeFile(`/src/${f.name}`, f.content || ' ');
  }

  const entryPoints = assets
    .filter(v => v.isEntry)
    .map(v => v.name)
    .map(v => `/src/${v}`);

  if (!entryPoints.length) throw new Error('No asset marked as entrypoint');

  const bundler = new Bundler(entryPoints, {
    outDir: '/dist',
    autoinstall: false,
    watch: false,
    cache: true,
    hmr: false,
    logLevel: 0,
    minify: options.minify,
    scopeHoist: options.scopeHoist,
    sourceMaps: options.sourceMaps
  });
  const bundle = await bundler.bundle();

  const output = [];
  for (let f of await fs.readdir('/dist')) {
    output.push({
      name: f,
      content: await fs.readFile('/dist/' + f, 'utf8')
    });
  }
  return output;
}

class ParcelWorker {
  async bundle(assets, options) {
    return bundle(assets, options);
  }
}

Comlink.expose(ParcelWorker, self);
