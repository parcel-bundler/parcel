import text from './text.json' with { type: 'text' };
import bytes from './bytes.json' with { type: 'bytes' };
import url from './url.json' with { type: 'url' };

export default {
  text,
  bytes: bytes instanceof Uint8Array ? Array.from(bytes) : 'not a Uint8Array',
  url: typeof url === 'string' && url.includes('.json'),
};
