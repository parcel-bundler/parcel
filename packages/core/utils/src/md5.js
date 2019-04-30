// @flow strict-local

import crypto from 'crypto';
import fs from 'fs';

type StringHashEncoding = 'hex' | 'latin1' | 'binary' | 'base64';

export function md5FromString(
  string: string,
  encoding: StringHashEncoding = 'hex'
): string {
  return crypto
    .createHash('md5')
    .update(string)
    .digest(encoding);
}

export function md5FromFilePath(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      // $FlowFixMe A Hash is a duplex stream
      .pipe(crypto.createHash('md5').setEncoding('hex'))
      .on('finish', function() {
        resolve(this.read());
      })
      .on('error', reject);
  });
}
