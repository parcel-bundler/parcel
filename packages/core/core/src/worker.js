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
import ConfigProvider from './ConfigProvider';

type Options = {
  parcelConfig: ParcelConfig,
  cliOpts: CLIOptions,
  env: JSONObject,
  configProvider?: ConfigProvider
};

let transformerRunner: ?TransformerRunner = null;
let packagerRunner: ?PackagerRunner = null;
export let configProvider: ?ConfigProvider = null;

export function init({
  parcelConfig,
  cliOpts,
  env,
  configProvider: provider
}: Options) {
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

  configProvider = provider || new ConfigProvider();
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
