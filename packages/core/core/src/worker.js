// @flow

import type {
  Bundle,
  CLIOptions,
  TransformerRequest,
  ParcelConfig,
  JSONObject
} from '@parcel/types';
import TransformerRunner from './TransformerRunner';
import PackagerRunner from './PackagerRunner';
import Config from './Config';
import Cache from '@parcel/cache';

type Options = {
  parcelConfig: ParcelConfig,
  cliOpts: CLIOptions,
  env: JSONObject
};

let transformerRunner: TransformerRunner | null = null;
let packagerRunner: PackagerRunner | null = null;

export function init({parcelConfig, cliOpts, env}: Options) {
  Object.assign(process.env, env || {});

  Cache.init(cliOpts);

  let config = new Config(
    parcelConfig,
    require.resolve('@parcel/config-default')
  );
  transformerRunner = new TransformerRunner({
    config,
    cliOpts
  });
  packagerRunner = new PackagerRunner({
    config,
    cliOpts
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
