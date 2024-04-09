// @flow strict-local
import type {FilePath, FileSystem, FileOptions} from '@parcel/types-internal';
import type {Readable, Writable} from 'stream';

import path from 'path';
import stream from 'stream';
import {promisify} from 'util';

export * from './NodeFS';
export * from './MemoryFS';
export * from './OverlayFS';

export type {FileSystem, FileOptions};

const pipeline: (Readable, Writable) => Promise<void> = promisify(
  stream.pipeline,
);

// Recursively copies a directory from the sourceFS to the destinationFS
export async function ncp(
  sourceFS: FileSystem,
  source: FilePath,
  destinationFS: FileSystem,
  destination: FilePath,
) {
  await destinationFS.mkdirp(destination);
  let files = await sourceFS.readdir(source);
  for (let file of files) {
    let sourcePath = path.join(source, file);
    let destPath = path.join(destination, file);
    let stats = await sourceFS.stat(sourcePath);
    if (stats.isFile()) {
      await pipeline(
        sourceFS.createReadStream(sourcePath),
        destinationFS.createWriteStream(destPath),
      );
    } else if (stats.isDirectory()) {
      await ncp(sourceFS, sourcePath, destinationFS, destPath);
    }
  }
}
