// @flow strict-local

import type {Blob} from '@parcel/types';

import {bufferStream} from './';

export function blobToBuffer(blob: Blob): Promise<Buffer> {
  if (typeof blob === 'function') {
    return bufferStream(blob());
  } else if (blob instanceof Buffer) {
    return Promise.resolve(Buffer.from(blob));
  } else {
    return Promise.resolve(Buffer.from(blob, 'utf8'));
  }
}

export async function blobToString(blob: Blob): Promise<string> {
  if (typeof blob === 'function') {
    return (await bufferStream(blob())).toString();
  } else if (blob instanceof Buffer) {
    return blob.toString();
  } else {
    return blob;
  }
}
