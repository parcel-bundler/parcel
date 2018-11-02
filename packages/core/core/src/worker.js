// @flow

import type {Bundle, CLIOptions, File, ParcelConfig} from '@parcel/types';
import TransformerRunner from './TransformerRunner';
import PackagerRunner from './PackagerRunner';
import Config from './Config';

type Options = {
  parcelConfig: ParcelConfig,
  cliOpts: CLIOptions
};

let transformerRunner: TransformerRunner | null = null;
let packagerRunner: PackagerRunner | null = null;

export function init({parcelConfig, cliOpts}: Options) {
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

export function runTransform(file: File) {
  if (!transformerRunner) {
    throw new Error('.runTransform() called before .init()');
  }

  return transformerRunner.transform(file);
}

export function runPackage(bundle: Bundle) {
  if (!packagerRunner) {
    throw new Error('.runPackage() called before .init()');
  }

  return packagerRunner.writeBundle(bundle);
}
