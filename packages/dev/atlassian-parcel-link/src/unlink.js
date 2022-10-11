#! /usr/bin/env node
// @flow strict-local

import type {CmdOptions} from './util';

import path from 'path';

import {validateAppRoot, validatePackageRoot} from './util';

export type UnlinkOptions = {|
  appRoot: string,
  dryRun?: boolean,
  log?: (...data: mixed[]) => void,
|};

export default function unlink({
  appRoot,
  dryRun = false,
  log = () => {},
}: UnlinkOptions) {
  validateAppRoot(appRoot);

  let opts: CmdOptions = {appRoot, dryRun, log};

  let packageRoot = path.join(__dirname, '../../../../packages');
  validatePackageRoot(packageRoot);
}
