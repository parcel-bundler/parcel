// @flow

import type {
  Bundle,
  ParcelOptions,
  TransformerRequest,
  JSONObject
} from '@parcel/types';
import TransformerRunner from './TransformerRunner';
import PackagerRunner from './PackagerRunner';
import Config from './ParcelConfig';
import Cache from '@parcel/cache';

type Options = {|
  config: Config,
  options: ParcelOptions,
  env: JSONObject
|};

let transformerRunner: TransformerRunner | null = null;
let packagerRunner: PackagerRunner | null = null;

export function init({options, env}: Options) {
  Object.assign(process.env, env || {});

  Cache.init(options);

  transformerRunner = new TransformerRunner({
    options
  });
  packagerRunner = new PackagerRunner({
    options
  });
}

export function runTransform(opts) {
  console.log('RUN TRANSFORM OPTS', opts);
  if (!transformerRunner) {
    throw new Error('.runTransform() called before .init()');
  }

  return transformerRunner.transform(opts);
}

export function runPackage(bundle: Bundle) {
  if (!packagerRunner) {
    throw new Error('.runPackage() called before .init()');
  }

  return packagerRunner.writeBundle(bundle);
}
