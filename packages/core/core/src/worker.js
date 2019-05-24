// @flow strict-local

import type {ParcelOptions, AssetRequest, JSONObject} from '@parcel/types';
import type {Bundle} from './types';
import type BundleGraph from './BundleGraph';

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

export function init({config, options, env}: Options) {
  Object.assign(process.env, env || {});

  Cache.init(options);

  transformerRunner = new TransformerRunner({
    config,
    options
  });
  packagerRunner = new PackagerRunner({
    config,
    options
  });
}

export function runTransform(req: AssetRequest) {
  if (!transformerRunner) {
    throw new Error('.runTransform() called before .init()');
  }

  return transformerRunner.transform(req);
}

export function runPackage(bundle: Bundle, bundleGraph: BundleGraph) {
  if (!packagerRunner) {
    throw new Error('.runPackage() called before .init()');
  }

  return packagerRunner.writeBundle(bundle, bundleGraph);
}
