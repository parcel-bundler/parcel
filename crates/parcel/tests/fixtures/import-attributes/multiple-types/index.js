import data from './local.json';
import text from './local.json' with { type: 'text' };
import bytes from './local.json' with { type: 'bytes' };

output = {
  data: data.hello,
  text,
  bytes: bytes instanceof Uint8Array ? Array.from(bytes) : 'not a Uint8Array',
};
