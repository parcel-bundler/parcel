#! /usr/bin/env node
// @flow strict-local
/* eslint-disable no-console */

import type {CmdOptions} from './util';

import path from 'path';

import {validateAppRoot, validatePackageRoot} from './util';

export type LinkOptions = {|
  appRoot: string,
  dryRun?: boolean,
  log?: (...data: mixed[]) => void,
|};

export default function link({
  appRoot,
  dryRun = false,
  log = () => {},
}: LinkOptions) {
  validateAppRoot(appRoot);

  let opts: CmdOptions = {appRoot, dryRun, log};

  let packageRoot = path.join(__dirname, '../../../../packages');
  validatePackageRoot(packageRoot);
}
