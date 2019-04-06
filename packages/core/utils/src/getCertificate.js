// @flow
import type {HTTPSOptions} from '@parcel/types';
import {readFile} from '@parcel/fs';

export default async function getCertificate(options: HTTPSOptions) {
  try {
    let cert = await readFile(options.cert);
    let key = await readFile(options.key);

    return {key, cert};
  } catch (err) {
    throw new Error('Certificate and/or key not found');
  }
}
