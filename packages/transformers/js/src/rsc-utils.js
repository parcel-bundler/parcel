/* eslint-disable */
import {generateEncryptionKey} from './rsc-utils.macro.js' with {type: 'macro'};
import {renderToReadableStream} from 'react-server-dom-parcel/server.edge';
import {createFromReadableStream} from 'react-server-dom-parcel/client.edge';

let importedKey;
async function getKey() {
  if (!importedKey) {
    const key = await generateEncryptionKey();
    importedKey = await crypto.subtle.importKey('raw', new Uint8Array(key), 'AES-GCM', true, ['encrypt', 'decrypt']);
  }

  return importedKey;
}

export async function encryptClosure(args) {
  let rscStream = renderToReadableStream(args);
  let buffers = [];
  let length = 0;
  for await (let buffer of rscStream) {
    length += buffer.length;
    buffers.push(buffer);
  }

  let concatenated = new Uint8Array(length);
  let offset = 0;
  for (let buffer of buffers) {
    concatenated.set(buffer, offset);
    offset += buffer.length;
  }

  let iv = crypto.getRandomValues(new Uint8Array(16));
  let data = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    await getKey(),
    concatenated
  );

  return [iv, new Uint8Array(data)];
}

export async function decryptClosure(args) {
  let [iv, data] = await args;
  let decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv
    },
    await getKey(),
    data
  );

  let stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(decrypted));
      controller.close();
    }
  });

  return createFromReadableStream(stream);
}
