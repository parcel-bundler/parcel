// @flow strict-local
import type {Blob, FilePath} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import type {AssetRequestDesc} from './types';

import {md5FromReadableStream, md5FromString, TapStream} from '@parcel/utils';
import path from 'path';

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

const BUFFER_LIMIT = 5000000; // 5mb

export default async function summarizeRequest(
  fs: FileSystem,
  req: AssetRequestDesc,
): Promise<{|content: Blob, hash: string, size: number, isSource: boolean|}> {
  let [{content, hash, size}, isSource] = await Promise.all([
    summarizeDiskRequest(fs, req),
    isFilePathSource(fs, req.filePath),
  ]);
  return {content, hash, size, isSource};
}

async function isFilePathSource(fs: FileSystem, filePath: FilePath) {
  return (
    !filePath.includes(NODE_MODULES) ||
    (await fs.realpath(filePath)) !== filePath
  );
}

function summarizeDiskRequest(
  fs: FileSystem,
  req: AssetRequestDesc,
): Promise<{|content: Blob, hash: string, size: number|}> {
  return new Promise((resolve, reject) => {
    let code = req.code;
    let content: Blob;
    let hash: string;
    let size: number;
    if (code == null) {
      // As an optimization for the common case of source code, while we read in
      // data to compute its md5 and size, buffer its contents in memory.
      // This avoids reading the data now, and then again during transformation.
      // If it exceeds BUFFER_LIMIT, throw it out and replace it with a stream to
      // lazily read it at a later point.
      content = Buffer.from([]);
      size = 0;

      let stream = fs.createReadStream(req.filePath);
      stream.on('error', reject);

      md5FromReadableStream(
        stream.pipe(
          new TapStream(buf => {
            size += buf.length;
            if (content instanceof Buffer) {
              if (size > BUFFER_LIMIT) {
                // if buffering this content would put this over BUFFER_LIMIT, replace
                // it with a stream
                content = fs.createReadStream(req.filePath);
              } else {
                content = Buffer.concat([content, buf]);
              }
            }
          }),
        ),
      ).then(hash => resolve({content, hash, size}), reject);
    } else {
      content = code;
      hash = md5FromString(code);
      size = Buffer.from(code).length;
      resolve({content, hash, size});
    }
  });
}
