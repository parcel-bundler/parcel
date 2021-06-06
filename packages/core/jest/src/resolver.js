// @flow
import path from 'path';
import {parcel} from './shared';

type JestResolveOptions = {
  basedir: string,
  ...
};

module.exports = function(request: string, options: JestResolveOptions): string {
  return parcel.resolve(request, path.isAbsolute(request) ? null : options.basedir + '/index');
};
