// @flow strict-local
import type {Blob, FilePath} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';

import path from 'path';

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

const BUFFER_LIMIT = 5000000; // 5mb

export default async function summarizeRequest(
  fs: FileSystem,
  req: {|filePath: FilePath, code?: string|},
): Promise<{|content: Blob, size: number, isSource: boolean|}> {
  let {content, size} = await summarizeDiskRequest(fs, req);
  let isSource = isFilePathSource(fs, req.filePath);
  return {content, size, isSource};
}

function isFilePathSource(fs: FileSystem, filePath: FilePath) {
  return !filePath.includes(NODE_MODULES);
}

async function summarizeDiskRequest(
  fs: FileSystem,
  req: {|filePath: FilePath, code?: string|},
): Promise<{|content: Blob, size: number|}> {
  let code = req.code;
  let content: Blob;
  let size: number;
  if (code == null) {
    // Get the filesize. If greater than BUFFER_LIMIT, use a stream to
    // compute the hash. In the common case, it's faster to just read the entire
    // file first and do the hash all at once without the overhead of streams.
    size = (await fs.stat(req.filePath)).size;
    if (size > BUFFER_LIMIT) {
      content = fs.createReadStream(req.filePath);
    } else {
      content = await fs.readFile(req.filePath);
    }
  } else {
    content = code;
    size = Buffer.byteLength(code);
  }

  return {content, size};
}
