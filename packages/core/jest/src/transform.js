// @flow
import {parcel} from './shared';

module.exports = {
  process(src: string, filename: string, config: any, options: any): string {
    let {code} = parcel.transform(filename);
    return code;
  },
};
