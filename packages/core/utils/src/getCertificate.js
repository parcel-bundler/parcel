// @flow
import type {FileSystem, HTTPSOptions} from '@parcel/types';

export default async function getCertificate(
  fs: FileSystem,
  options: HTTPSOptions,
): Promise<{|cert: Buffer, key: Buffer|}> {
  try {
    let cert = await fs.readFile(options.cert);
    let key = await fs.readFile(options.key);

    return {key, cert};
  } catch (err) {
    throw new Error('Certificate and/or key not found');
  }
}
