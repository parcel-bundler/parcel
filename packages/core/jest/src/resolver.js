// @flow
import Parcel from '@parcel/core';
import path from 'path';
import {parcel} from './shared';

module.exports = function(request, options) {
  return parcel.resolve(request, path.isAbsolute(request) ? null : options.basedir + '/index');
};
