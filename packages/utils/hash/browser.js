// @flow
import xxhash from 'xxhash-wasm';

let h64, h64Raw;
export const init: Promise<void> = xxhash().then(xxh => {
  ({h64, h64Raw} = xxh);
});

const encoder = new TextEncoder();
export function hashString(s: string): string {
  return h64(s);
}
export function hashBuffer(b: Uint8Array): string {
  return toHex(h64Raw(b));
}
export class Hash {
  data: Array<Uint8Array>;
  constructor() {
    this.data = [];
  }
  writeString(s: string) {
    this.data.push(encoder.encode(s));
  }
  writeBuffer(b: Uint8Array) {
    this.data.push(b);
  }
  finish(): string {
    return hashBuffer(concatUint8Arrays(this.data));
  }
}

function concatUint8Arrays(arrays: Array<Uint8Array>): Uint8Array {
  let totalLength = 0;
  for (let a of arrays) {
    totalLength += a.byteLength;
  }
  let result = new Uint8Array(totalLength);
  let offset = 0;
  for (let a of arrays) {
    result.set(a, offset);
    offset += a.byteLength;
  }
  return result;
}

function toHex(arr) {
  let dataView = new DataView(arr.buffer);
  return (
    dataView.getUint32(0, true).toString(16) +
    dataView.getUint32(4, true).toString(16)
  );
}
