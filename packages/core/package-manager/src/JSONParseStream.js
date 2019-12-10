// @flow strict-local

import type {JSONObject} from '@parcel/types';
import {Transform} from 'stream';

// Transforms chunks of json strings to parsed objects.
// Pair with split2 to parse stream of newline-delimited text.
export default class JSONParseStream extends Transform {
  constructor(options: mixed) {
    super({...options, objectMode: true});
  }

  // $FlowFixMe We are in object mode, so we emit objects, not strings
  _transform(
    chunk: Buffer | string,
    encoding: string,
    callback: (err: ?Error, parsed: ?JSONObject) => mixed,
  ) {
    try {
      callback(null, JSON.parse(chunk.toString()));
    } catch (err) {
      callback(err);
    }
  }
}
