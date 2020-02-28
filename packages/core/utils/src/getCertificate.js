// @flow
import type {HTTPSOptions} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';

export default async function getCertificate(
  fs: FileSystem,
  options: HTTPSOptions,
) {
  try {
    let cert = await fs.readFile(options.cert);
    let key = await fs.readFile(options.key);

    return {key, cert};
  } catch (err) {
    throw new Error('Certificate and/or key not found');
  }
}
