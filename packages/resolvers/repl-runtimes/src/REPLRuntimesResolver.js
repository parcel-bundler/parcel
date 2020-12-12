// @flow

import {Resolver} from '@parcel/plugin';
import nullthrows from 'nullthrows';
import fs from 'fs';

const FILES = new Map([
  [
    '@parcel/runtime-js/src/bundle-manifest.js',
    fs.readFileSync(
      __dirname + '/../../../@parcel/runtime-js/src/bundle-manifest.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/bundle-url.js',
    fs.readFileSync(
      __dirname + '/../../../@parcel/runtime-js/src/bundle-url.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/cacheLoader.js',
    fs.readFileSync(
      __dirname + '/../../../@parcel/runtime-js/src/cacheLoader.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/get-worker-url.js',
    fs.readFileSync(
      __dirname + '/../../../@parcel/runtime-js/src/get-worker-url.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/relative-path.js',
    fs.readFileSync(
      __dirname + '/../../../@parcel/runtime-js/src/relative-path.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/loaders/browser/preload-loader.js',
    fs.readFileSync(
      __dirname +
        '/../../../@parcel/runtime-js/src/loaders/browser/preload-loader.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/loaders/browser/prefetch-loader.js',
    fs.readFileSync(
      __dirname +
        '/../../../@parcel/runtime-js/src/loaders/browser/prefetch-loader.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/loaders/browser/css-loader.js',
    fs.readFileSync(
      __dirname +
        '/../../../@parcel/runtime-js/src/loaders/browser/css-loader.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/loaders/browser/html-loader.js',
    fs.readFileSync(
      __dirname +
        '/../../../@parcel/runtime-js/src/loaders/browser/html-loader.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/loaders/browser/js-loader.js',
    fs.readFileSync(
      __dirname +
        '/../../../@parcel/runtime-js/src/loaders/browser/js-loader.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/loaders/browser/wasm-loader.js',
    fs.readFileSync(
      __dirname +
        '/../../../@parcel/runtime-js/src/loaders/browser/wasm-loader.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/loaders/browser/import-polyfill.js',
    fs.readFileSync(
      __dirname +
        '/../../../@parcel/runtime-js/src/loaders/browser/import-polyfill.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/loaders/worker/js-loader.js',
    fs.readFileSync(
      __dirname +
        '/../../../@parcel/runtime-js/src/loaders/worker/js-loader.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/loaders/worker/wasm-loader.js',
    fs.readFileSync(
      __dirname +
        '/../../../@parcel/runtime-js/src/loaders/worker/wasm-loader.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/loaders/node/css-loader.js',
    fs.readFileSync(
      __dirname + '/../../../@parcel/runtime-js/src/loaders/node/css-loader.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/loaders/node/html-loader.js',
    fs.readFileSync(
      __dirname +
        '/../../../@parcel/runtime-js/src/loaders/node/html-loader.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/loaders/node/js-loader.js',
    fs.readFileSync(
      __dirname + '/../../../@parcel/runtime-js/src/loaders/node/js-loader.js',
      'utf8',
    ),
  ],
  [
    '@parcel/runtime-js/src/loaders/node/wasm-loader.js',
    fs.readFileSync(
      __dirname +
        '/../../../@parcel/runtime-js/src/loaders/node/wasm-loader.js',
      'utf8',
    ),
  ],
  [
    '@parcel/transformer-js/src/esmodule-helpers.js',
    fs.readFileSync(
      __dirname + '/../../../@parcel/transformer-js/src/esmodule-helpers.js',
      'utf8',
    ),
  ],
]);

function keyStartsWith<T>(map: Map<string, T>, s: string) {
  for (let k of map.keys()) {
    if (k.startsWith(s)) {
      return k;
    }
  }
}

export default (new Resolver({
  resolve({dependency}) {
    let key = keyStartsWith(FILES, dependency.moduleSpecifier);
    if (key != null) {
      return {
        filePath: '/VIRTUAL/' + key,
        code: nullthrows(FILES.get(key)),
      };
    }
  },
}): Resolver);
