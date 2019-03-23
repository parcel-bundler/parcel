// @flow
import {readFile} from '@parcel/fs';

export default async function getCertificate(options: {
  cert: string,
  key: string
}) {
  try {
    let cert = await readFile(options.cert);
    let key = await readFile(options.key);

    return {key, cert};
  } catch (err) {
    throw new Error('Certificate and/or key not found');
  }
}
