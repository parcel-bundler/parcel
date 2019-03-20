// @flow

import type {
  Bundle,
  ParcelOptions,
  TransformerRequest,
  JSONObject
} from '@parcel/types';
import TransformerRunner from './TransformerRunner';
import PackagerRunner from './PackagerRunner';
import Config from './Config';
import Cache from '@parcel/cache';

type Options = {|
  config: Config,
  options: ParcelOptions,
  env: JSONObject
|};

let transformerRunner: TransformerRunner | null = null;
let packagerRunner: PackagerRunner | null = null;

<<<<<<< HEAD
export function init({config, options, env}: Options) {
=======
export function init({cliOpts, env}: Options) {
>>>>>>> Added new node types
  Object.assign(process.env, env || {});

  Cache.init(options);

  transformerRunner = new TransformerRunner({
<<<<<<< HEAD
    config,
    options
  });
  packagerRunner = new PackagerRunner({
    config,
    options
=======
    cliOpts
  });
  packagerRunner = new PackagerRunner({
    cliOpts
>>>>>>> Added new node types
  });
}

export function runTransform(req: TransformerRequest) {
  if (!transformerRunner) {
    throw new Error('.runTransform() called before .init()');
  }

  return transformerRunner.transform(req);
}

export function runPackage(bundle: Bundle) {
  if (!packagerRunner) {
    throw new Error('.runPackage() called before .init()');
  }

  return packagerRunner.writeBundle(bundle);
}
