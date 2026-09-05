import bytes from './local.json' with { type: 'bytes' };
output = bytes instanceof Uint8Array ? Array.from(bytes) : 'not a Uint8Array';
