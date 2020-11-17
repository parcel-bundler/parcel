import * as msgpack from '@msgpack/msgpack';

export async function decode(data) {
  return msgpack.decode(data, {extensionCodec});
}

// Derived from
// https://github.com/msgpack/msgpack-javascript#extension-types
const extensionCodec = new msgpack.ExtensionCodec();
extensionCodec.register({
  type: 0,
  decode(value) {
    return new Set(msgpack.decode(value, {extensionCodec}));
  },
});

extensionCodec.register({
  type: 1,
  decode(value) {
    return new Map(msgpack.decode(value, {extensionCodec}));
  },
});
